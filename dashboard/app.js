// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, the top-signal strip, a filterable and sortable table, a per-protocol detail view
// with the model's own inputs recomputed from the row, and the protocol's farm plan.
// No network: every byte shown here is in data.js. No framework.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var PAGE = 25;
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, page: 1, selected: null };

  /* ---------- formatting ---------- */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }

  /* ---------- the model, in the page ----------
     The same function lib/model.ts scores with: the page recomputes a row from the snapshot's
     figures and checks it against the number data.js carries, so code and data are visibly the
     same arithmetic.
  */
  function impliedOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var reachMult = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.reach_cap) * m.reach_weight;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturityMult * reachMult));
  }

  /* ---------- farm plan, derived in the page ----------
     Category, chains, TVL and age decide the action, the capital, the hold and every cost and
     time. No protocol name is special-cased.
  */
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return "Mint or deposit $" + capital + " of the stable asset through " + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  /* ---------- dom helper ---------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* ---------- url state (shareable views) ---------- */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /* ---------- data ---------- */
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function categoryList() {
    var counts = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  }

  /* ---------- sections ---------- */
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', null,
        DATA.board_size + ' pre-token protocols ranked by ',
        el('em', { text: 'implied launch value' })
      ),
      el('p', { text: 'Every protocol here records no token: no market cap, no symbol, no CoinGecko id in the index. Implied value is the model\u2019s claim about what a token would be worth if the record stayed as it is \u2014 TVL, seven-day growth, the time run with no token, and chain reach. The watchlist is the floor; the early radar adds ' + DATA.early_size + ' pre-token protocols below it. ' + DATA.live_size + ' protocols that already trade are set aside, with the market\u2019s own figures.' })
    );
  }

  function facts() {
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      el('div', { class: 'fact' }, el('span', { text: 'Rows scored' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Early, below the floor' }), el('b', { text: String(DATA.early_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(DATA.live_size) }))
    );
  }

  function signalStrip() {
    var top = DATA.rows.slice(0, 5);
    return el('section', { class: 'signal', 'aria-label': 'Top five signals' }, top.map(function (r) {
      return el('button', { class: 'sig', type: 'button', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'pos', text: '#' + r.rank }),
        el('span', { class: 'nm', text: r.name }),
        el('span', { class: 'vl', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'cat', text: (r.category || 'Other') + ' \u00b7 ' + fmtAge(r.age_days) })
      );
    }));
  }

  function controls() {
    var cats = categoryList();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search protocol\u2026', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.page = 1; writeHash(); renderTable(); });
    var tabs = el('div', { class: 'tabs' },
      el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token radar', onclick: function () { state.tab = 'pre-token'; state.page = 1; renderTable(); } }),
      el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; renderTable(); } })
    );
    return el('div', null,
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), tabs),
        el('span', { class: 'count', id: 'row-count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.rows.length + ' rows' : DATA.live.length + ' live-token protocols' })
      ),
      state.tab === 'pre-token'
        ? el('div', { class: 'chips', 'role': 'group', 'aria-label': 'Filter by category' },
          el('button', { class: 'chip' + (state.category === 'all' ? ' on' : ''), type: 'button', onclick: function () { state.category = 'all'; state.page = 1; writeHash(); renderTable(); } }, 'All', el('b', { text: String(DATA.rows.length) })),
          cats.slice(0, 9).map(function (c) {
            var n = DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length;
            return el('button', { class: 'chip' + (state.category === c ? ' on' : ''), type: 'button', onclick: function () { state.category = c; state.page = 1; writeHash(); renderTable(); } }, c, el('b', { text: String(n) }));
          }),
          cats.length > 9
            ? el('select', { class: 'chip', id: 'more-cats', 'aria-label': 'More categories', value: state.category, onchange: function (e) { state.category = e.target.value; state.page = 1; writeHash(); renderTable(); } },
              el('option', { value: '', text: 'More categories\u2026' }),
              cats.slice(9).map(function (c) { return el('option', { value: c, text: c }); })
            )
            : null
        )
        : null
    );
  }

  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label,
        state.sort === key ? el('span', { class: 'arr', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * PAGE, state.page * PAGE);
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.page = 1; writeHash(); renderTable(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd;
    var tbody = el('tbody');
    slice.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'name' }, el('b', { text: r.name }), el('div', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'an unnamed chain') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String(r.chains && r.chains.length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model inputs and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL', 'num'),
            sortHeader('growth', '7d \u0394', 'num'),
            sortHeader('age', 'Age', 'num'),
            sortHeader('chains', 'Chains', 'num'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      ),
      el('div', { class: 'pager' },
        el('button', { class: 'button', type: 'button', disabled: state.page <= 1 ? 'disabled' : null, text: '\u2039 Prev', onclick: function () { state.page--; renderTable(); } }),
        el('span', { text: 'page ' + state.page + ' of ' + pages }),
        el('button', { class: 'button', type: 'button', disabled: state.page >= pages ? 'disabled' : null, text: 'Next \u203a', onclick: function () { state.page++; renderTable(); } })
      )
    );
  }

  function liveTable() {
    var list = DATA.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'trading' })),
        el('td', { class: 'name' }, el('b', { text: r.name }), el('div', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so market cap is a fact, not a model. They never enter the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d \u0394' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' })
          )),
          tbody
        )
      ),
      el('p', { class: 'mcap-note', text: 'Shown for contrast: once a token trades, its value is set by the market, and the radar has no further job for it.' })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, stated here and recomputed by the page on the detail view. No protocol name is special-cased anywhere.' }),
      el('div', { class: 'formula' },
        'implied = max(1, round( tvl_usd \u00d7 ' + m.base_multiple +
        ' \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ')' +
        ' \u00d7 (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00d7 ' + m.maturity_range + ')' +
        ' \u00d7 (1 + min(chains\u22121, ' + m.reach_cap + ') \u00d7 ' + m.reach_weight + ') ))'
      ),
      el('div', { class: 'grid' },
        el('div', null, el('span', { text: 'base_multiple' }), el('b', { text: String(m.base_multiple) })),
        el('div', null, el('span', { text: 'growth_weight' }), el('b', { text: String(m.growth_weight) })),
        el('div', null, el('span', { text: 'maturity floor\u2192max' }), el('b', { text: m.maturity_floor + ' \u2192 ' + (m.maturity_floor + m.maturity_range).toFixed(2) })),
        el('div', null, el('span', { text: 'reach per chain' }), el('b', { text: '+' + (m.reach_weight * 100).toFixed(0) + '% to ' + (m.reach_cap + 1) + ' chains' }))
      ),
      el('p', { class: 'sub', text: 'TVL is the size of the base; the seven-day change of that TVL is momentum; the time since first listing is how long the protocol has run with no token (an unlisted age uses ' + m.unknown_age_days + ' days); chain count is reach, a launch distributed on more chains has more room. This is an estimate, not a price, and never a promise of a token.' })
    );
  }

  /* ---------- detail dialog ---------- */
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); renderTable(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var m = DATA.model;
    var check = impliedOf(row, m);
    var capital = capitalFor(row);
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (DATA.watchlist.indexOf(row.slug) >= 0 ? ' \u00b7 watchlist' : ' \u00b7 early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.slice(0, 4).join(', ') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) : '') : 'an unnamed chain') + ' \u00b7 records no token' })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value \u2014 ' + DATA.model_version }),
      el('div', { class: 'equation' },
        eq('TVL', fmtUsd(row.tvl_usd)),
        eq('Seven-day growth', fmtPct(row.change_7d)),
        eq('Age with no token', fmtAge(row.age_days)),
        eq('Chains', String(row.chains && row.chains.length)),
        eq('Growth \u00d7', String(row.growth_multiplier)),
        eq('Maturity \u00d7', String(row.maturity_multiplier)),
        eq('Reach \u00d7', String(row.reach_multiplier)),
        eq('Implied value', fmtUsd(row.implied_value_usd), true)
      ),
      el('div', { class: 'upside' },
        el('div', null, el('span', { text: 'Farm capital (step 2)' }), el('b', { text: '$' + capital })),
        el('div', null, el('span', { text: 'Qualifying hold (step 4)' }), el('b', { class: 'big', text: holdDaysFor(row.age_days) + ' days' })),
        el('div', null, el('span', { text: 'Page recomputes' }), el('b', { text: fmtUsd(check) }))
      ),
      el('p', { class: 'sub', text: 'The page just recomputed this row from the snapshot figures with the same function the board used: ' + fmtUsd(check) + (check === row.implied_value_usd ? ', the same number data.js carries \u2014 code and data agree.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan \u2014 six steps, each with a cost and a time' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null, el('div', null, el('b', { text: s.text }), el('span', { class: 'cost', text: 'Cost: ' + s.cost + ' \u00b7 Time: ' + s.time })));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    renderTable();
  }
  function eq(label, value, hl) {
    return el('div', { class: hl ? 'hl' : '' }, el('span', { text: label }), el('b', { class: 'num', text: value }));
  }

  /* ---------- render ---------- */
  function renderTable() {
    var host = document.getElementById('table-host');
    if (!host) return;
    var count = document.getElementById('row-count');
    if (count) count.textContent = state.tab === 'pre-token' ? rows().length + ' of ' + DATA.rows.length + ' rows' : DATA.live.length + ' live-token protocols';
    if (state.tab === 'pre-token') {
      Array.prototype.forEach.call(document.querySelectorAll('button.chip'), function (c) {
        var name = c.textContent.replace(/\s*\d+$/, '').trim();
        var want = state.category === 'all' ? name === 'All' : name === state.category;
        c.classList.toggle('on', want);
      });
      var more = document.getElementById('more-cats');
      if (more) more.value = more.querySelector('option[value="' + CSS.escape(state.category) + '"]') ? state.category : '';
    }
    host.textContent = '';
    host.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(facts());
    if (state.tab === 'pre-token') shell.appendChild(signalStrip());
    shell.appendChild(controls());
    var host = el('div', { id: 'table-host' });
    shell.appendChild(host);
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    renderTable();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
