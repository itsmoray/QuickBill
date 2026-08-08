// ======================================================
// ANCHAL GROCERY BILLING — Frontend (PWA, hosted on GitHub Pages)
// Talks to the Google Apps Script backend as a JSON API.
// ======================================================

// >>> IMPORTANT: paste your Apps Script Web App URL here after deploying it <<<
// It looks like: https://script.google.com/macros/s/AKfycb.../exec
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz4KDUXcyXie9qiXFPyyZ90Kk0C5elfoDWU-6CpIAzbAU-y4upv7gNH4go2mVINSp1k/exec';

// ---------- API HELPER ----------
// NOTE: uses XMLHttpRequest instead of fetch() on purpose. Apps Script's /exec
// URL always 302-redirects to script.googleusercontent.com, and Safari's fetch()
// frequently fails to follow that redirect on POST requests (throws a generic
// "Load failed" TypeError). XHR follows it correctly across all browsers.
function callAPI(action, params) {
  var payload = Object.assign({ action: action }, params || {});
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', APPS_SCRIPT_URL, true);
    // text/plain avoids a CORS preflight (Apps Script can't respond to OPTIONS requests)
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error('Server returned status ' + xhr.status));
        return;
      }
      var res;
      try {
        res = JSON.parse(xhr.responseText);
      } catch (e) {
        reject(new Error('Unexpected response from server.'));
        return;
      }
      if (res && res.message === 'SESSION_EXPIRED') {
        showToast('Session expired. Please log in again.');
        doLogout();
        reject(new Error('SESSION_EXPIRED'));
        return;
      }
      resolve(res);
    };
    xhr.onerror = function () {
      reject(new Error('Network request failed. Check your internet connection.'));
    };
    xhr.send(JSON.stringify(payload));
  });
}

// ---------- STATE ----------
var session = { token: null, role: null, fullName: null };
var currentBillItems = [];
var entryMode = 'piece';
var creditType = 'Credit';

window.onload = function () {
  if (APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    document.getElementById('loginError').innerText =
      'Setup needed: open app.js and paste your Apps Script Web App URL into APPS_SCRIPT_URL.';
  }
  var saved = localStorage.getItem('grocerySession');
  if (saved) {
    try {
      session = JSON.parse(saved);
      showApp();
    } catch (e) { localStorage.removeItem('grocerySession'); }
  }
  document.getElementById('reportDate').valueAsDate = new Date();
  document.getElementById('reportMonth').value = new Date().toISOString().slice(0, 7);
  document.getElementById('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('SW registration failed', err); });
  }
};

function showToast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}

// ---------- LOGIN / LOGOUT ----------
function doLogin() {
  var u = document.getElementById('loginUsername').value.trim();
  var p = document.getElementById('loginPassword').value;
  var errEl = document.getElementById('loginError');
  errEl.innerText = '';
  if (!u || !p) { errEl.innerText = 'Please enter username and password.'; return; }
  var btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerText = 'Signing in...';
  callAPI('login', { username: u, password: p })
    .then(function (res) {
      btn.disabled = false; btn.innerText = 'Login';
      if (res.success) {
        session = { token: res.token, role: res.role, fullName: res.fullName };
        localStorage.setItem('grocerySession', JSON.stringify(session));
        showApp();
      } else {
        errEl.innerText = res.message || 'Login failed.';
      }
    })
    .catch(function (err) {
      btn.disabled = false; btn.innerText = 'Login';
      if (err.message !== 'SESSION_EXPIRED') errEl.innerText = 'Connection error: ' + err.message;
    });
}

function doLogout() {
  if (session.token) callAPI('logout', { token: session.token }).catch(function () {});
  localStorage.removeItem('grocerySession');
  session = { token: null, role: null, fullName: null };
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('staffNameLabel').innerText = session.fullName + ' • ' + session.role;
  if (session.role === 'Manager') document.getElementById('adminNavBtn').classList.remove('hidden');
  refreshDayStatus();
  loadQuickItems();
}

// ---------- TABS ----------
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.add('hidden'); });
  document.getElementById('tab-' + tab).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
  document.querySelector('.nav-btn[data-tab="' + tab + '"]').classList.add('active');
  if (tab === 'day') refreshDayStatus();
  if (tab === 'credits') loadCreditLedger();
  if (tab === 'admin') { loadUsers(); loadQuickItemsAdmin(); }
}

// ---------- DAY STATUS ----------
function refreshDayStatus() {
  callAPI('getTodayStatus', { token: session.token })
    .then(function (status) {
      var badge = document.getElementById('dayBadge');
      var isOpen = status.status === 'Open';
      badge.innerText = isOpen ? 'Day Open' : 'Day Closed';
      badge.className = 'day-badge ' + (isOpen ? 'open' : 'closed');
      renderDayCard(status);
      if (status.status === 'Open') loadTodayExpenses();
    })
    .catch(function () {});
}

function renderDayCard(status) {
  var el = document.getElementById('dayStatusCard');
  if (status.status === 'Open') {
    el.innerHTML =
      '<h3>Day is Open</h3>' +
      '<div class="stat-row"><span>Opened by</span><span class="val">' + status.openedBy + '</span></div>' +
      '<div class="stat-row"><span>Opening Time</span><span class="val">' + status.openTime + '</span></div>' +
      '<div class="stat-row"><span>Opening Cash</span><span class="val">₹' + Number(status.openingCash).toFixed(2) + '</span></div>' +
      '<div class="field" style="margin-top:14px"><label>Closing Cash Count (₹)</label><input type="number" id="closingCashInput" min="0" step="0.01"></div>' +
      '<button class="btn danger" onclick="submitCloseDay()">Close Day</button>';
  } else if (status.status === 'Closed') {
    el.innerHTML =
      '<h3>Day Closed</h3>' +
      '<div class="stat-row"><span>Total Sales</span><span class="val">₹' + Number(status.totalSales).toFixed(2) + '</span></div>' +
      '<div class="stat-row"><span>Total Expenses</span><span class="val">₹' + Number(status.totalExpenses).toFixed(2) + '</span></div>' +
      '<div class="stat-row"><span>Closed by</span><span class="val">' + status.closedBy + ' at ' + status.closeTime + '</span></div>' +
      '<p style="color:var(--muted);font-size:13px;margin-top:10px">Today\'s day has already been closed. Come back tomorrow to open a new day.</p>';
  } else {
    el.innerHTML =
      '<h3>Day Not Opened Yet</h3>' +
      '<div class="field"><label>Opening Cash (₹)</label><input type="number" id="openingCashInput" min="0" step="0.01" value="0"></div>' +
      '<button class="btn" onclick="submitOpenDay()">Open Day</button>';
  }
}

function submitOpenDay() {
  var cash = document.getElementById('openingCashInput').value || 0;
  callAPI('openDay', { token: session.token, openingCash: cash })
    .then(function (res) {
      if (res.success) { showToast('Day opened.'); refreshDayStatus(); }
      else showToast(res.message);
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message); });
}

function submitCloseDay() {
  var cash = document.getElementById('closingCashInput').value;
  if (cash === '' || cash === null) { showToast('Please enter the counted closing cash.'); return; }
  if (!confirm('Close the day? This cannot be undone.')) return;
  callAPI('closeDay', { token: session.token, closingCash: cash })
    .then(function (res) {
      if (res.success) {
        var diffMsg = res.difference === 0 ? 'Cash matches exactly!' :
          (res.difference > 0 ? '₹' + res.difference.toFixed(2) + ' more than expected.' : '₹' + Math.abs(res.difference).toFixed(2) + ' short.');
        showToast('Day closed. Sales: ₹' + res.totalSales.toFixed(2) + '. ' + diffMsg);
        refreshDayStatus();
      } else showToast(res.message);
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message); });
}

// ---------- EXPENSES ----------
function submitExpense() {
  var desc = document.getElementById('expDesc').value.trim();
  var amt = document.getElementById('expAmount').value;
  if (!desc || !amt) { showToast('Enter description and amount.'); return; }
  callAPI('addExpense', { token: session.token, description: desc, amount: amt })
    .then(function () {
      showToast('Expense added.');
      document.getElementById('expDesc').value = '';
      document.getElementById('expAmount').value = '';
      loadTodayExpenses();
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message); });
}

function loadTodayExpenses() {
  callAPI('getTodayExpenses', { token: session.token })
    .then(function (list) {
      var el = document.getElementById('expenseList');
      if (list.length === 0) { el.innerHTML = '<div class="empty-state">No expenses logged today</div>'; return; }
      el.innerHTML = list.map(function (e) {
        return '<div class="bill-item-row"><div class="info"><div class="name">' + e.description + '</div><div class="meta">' + e.time + ' • ' + e.enteredBy + '</div></div><div class="amt">₹' + Number(e.amount).toFixed(2) + '</div></div>';
      }).join('');
    })
    .catch(function () {});
}

// ---------- QUICK ITEMS (BILLING) ----------
function loadQuickItems() {
  callAPI('getQuickItems', { token: session.token })
    .then(function (items) {
      var grid = document.getElementById('quickItemsGrid');
      if (items.length === 0) { grid.innerHTML = '<div class="empty-state">No quick items set up yet</div>'; return; }
      grid.innerHTML = items.map(function (it, idx) {
        return '<div class="quick-item-btn" onclick="quickAdd(' + idx + ')">' + it.ItemName + '<span class="price">₹' + it.DefaultPrice + '/' + it.Unit + '</span></div>';
      }).join('');
      window._quickItemsCache = items;
    })
    .catch(function () {});
}

function quickAdd(idx) {
  var it = window._quickItemsCache[idx];
  if (it.Unit === 'kg') {
    var wt = prompt('Weight in kg for ' + it.ItemName + ':', '1');
    if (wt === null || isNaN(wt) || Number(wt) <= 0) return;
    var lineTotal = Number(wt) * Number(it.DefaultPrice);
    currentBillItems.push({ name: it.ItemName, qty: '', weight: wt, unit: 'kg', price: it.DefaultPrice, lineTotal: lineTotal });
  } else {
    var qty = prompt('Quantity for ' + it.ItemName + ':', '1');
    if (qty === null || isNaN(qty) || Number(qty) <= 0) return;
    var lineTotal2 = Number(qty) * Number(it.DefaultPrice);
    currentBillItems.push({ name: it.ItemName, qty: qty, weight: '', unit: 'piece', price: it.DefaultPrice, lineTotal: lineTotal2 });
  }
  renderBillItems();
}

// ---------- MANUAL ITEM ENTRY ----------
function setEntryMode(mode) {
  entryMode = mode;
  document.getElementById('modePiece').classList.toggle('selected', mode === 'piece');
  document.getElementById('modeWeight').classList.toggle('selected', mode === 'weight');
  document.getElementById('pieceRow').classList.toggle('hidden', mode !== 'piece');
  document.getElementById('weightRow').classList.toggle('hidden', mode !== 'weight');
}

function addManualItem() {
  var name = document.getElementById('manualName').value.trim();
  if (!name) { showToast('Enter an item name.'); return; }
  var item;
  if (entryMode === 'piece') {
    var qty = Number(document.getElementById('manualQty').value);
    var price = Number(document.getElementById('manualPricePiece').value);
    if (!qty || !price) { showToast('Enter quantity and price.'); return; }
    item = { name: name, qty: qty, weight: '', unit: 'piece', price: price, lineTotal: qty * price };
  } else {
    var weight = Number(document.getElementById('manualWeight').value);
    var unit = document.getElementById('manualUnit').value;
    var priceKg = Number(document.getElementById('manualPriceWeight').value);
    if (!weight || !priceKg) { showToast('Enter weight and price per kg.'); return; }
    var weightInKg = unit === 'g' ? weight / 1000 : weight;
    item = { name: name, qty: '', weight: weight + ' ' + unit, unit: unit, price: priceKg, lineTotal: weightInKg * priceKg };
  }
  currentBillItems.push(item);
  renderBillItems();
  document.getElementById('manualName').value = '';
  document.getElementById('manualQty').value = 1;
  document.getElementById('manualPricePiece').value = '';
  document.getElementById('manualWeight').value = '';
  document.getElementById('manualPriceWeight').value = '';
}

function removeBillItem(idx) {
  currentBillItems.splice(idx, 1);
  renderBillItems();
}

function renderBillItems() {
  var el = document.getElementById('billItemsList');
  if (currentBillItems.length === 0) {
    el.innerHTML = '<div class="empty-state">No items added yet</div>';
  } else {
    el.innerHTML = currentBillItems.map(function (it, idx) {
      var meta = it.qty ? (it.qty + ' × ₹' + it.price) : (it.weight + ' @ ₹' + it.price + '/kg');
      return '<div class="bill-item-row"><div class="info"><div class="name">' + it.name + '</div><div class="meta">' + meta + '</div></div><div class="amt">₹' + it.lineTotal.toFixed(2) + '</div><button class="del-btn" onclick="removeBillItem(' + idx + ')">✕</button></div>';
    }).join('');
  }
  updateTotals();
}

function updateTotals() {
  var subtotal = currentBillItems.reduce(function (s, it) { return s + it.lineTotal; }, 0);
  var discount = Number(document.getElementById('discount').value) || 0;
  var total = Math.max(subtotal - discount, 0);
  document.getElementById('subtotalDisplay').innerText = '₹' + subtotal.toFixed(2);
  document.getElementById('discountDisplay').innerText = '₹' + discount.toFixed(2);
  document.getElementById('totalDisplay').innerText = '₹' + total.toFixed(2);
}
document.addEventListener('input', function (e) { if (e.target && e.target.id === 'discount') updateTotals(); });

function completeBill() {
  if (currentBillItems.length === 0) { showToast('Add at least one item.'); return; }
  var paymentMode = document.getElementById('paymentMode').value;
  var custName = document.getElementById('custName').value.trim();
  if (paymentMode === 'Credit' && !custName) { showToast('Customer name is required for credit sales.'); return; }
  var billData = {
    customerName: custName,
    customerPhone: document.getElementById('custPhone').value.trim(),
    paymentMode: paymentMode,
    discount: Number(document.getElementById('discount').value) || 0,
    items: currentBillItems
  };
  var btn = document.getElementById('completeBillBtn');
  btn.disabled = true; btn.innerText = 'Saving...';
  callAPI('saveBill', { token: session.token, billData: billData })
    .then(function (res) {
      btn.disabled = false; btn.innerText = 'Complete Bill';
      if (res.success) {
        showToast('Bill saved! Total ₹' + res.total.toFixed(2));
        currentBillItems = [];
        document.getElementById('custName').value = '';
        document.getElementById('custPhone').value = '';
        document.getElementById('discount').value = 0;
        document.getElementById('paymentMode').value = 'Cash';
        renderBillItems();
      } else {
        showToast(res.message);
      }
    })
    .catch(function (err) {
      btn.disabled = false; btn.innerText = 'Complete Bill';
      if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message);
    });
}

// ---------- CREDITS ----------
function setCreditType(type) {
  creditType = type;
  document.getElementById('crTypeCredit').classList.toggle('selected', type === 'Credit');
  document.getElementById('crTypePayment').classList.toggle('selected', type === 'Payment');
}

function submitCredit() {
  var name = document.getElementById('crName').value.trim();
  var amount = document.getElementById('crAmount').value;
  if (!name || !amount) { showToast('Enter customer name and amount.'); return; }
  callAPI('addCreditEntry', {
    token: session.token, customerName: name, phone: document.getElementById('crPhone').value.trim(),
    type: creditType, amount: amount, notes: document.getElementById('crNotes').value.trim()
  })
    .then(function (res) {
      if (res.success) {
        showToast('Saved. New balance: ₹' + res.newBalance.toFixed(2));
        document.getElementById('crName').value = '';
        document.getElementById('crPhone').value = '';
        document.getElementById('crAmount').value = '';
        document.getElementById('crNotes').value = '';
        loadCreditLedger();
      } else showToast(res.message);
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message); });
}

function loadCreditLedger() {
  callAPI('getCreditLedger', { token: session.token })
    .then(function (list) {
      var el = document.getElementById('creditLedgerList');
      if (list.length === 0) { el.innerHTML = '<div class="empty-state">No outstanding balances</div>'; return; }
      el.innerHTML = list.map(function (c) {
        return '<div class="customer-row"><div><div class="name">' + c.customerName + '</div><div class="phone">' + (c.phone || '') + '</div></div><div class="bal">₹' + c.balance.toFixed(2) + '</div></div>';
      }).join('');
    })
    .catch(function () {});
}

// ---------- REPORTS ----------
function loadDailyReport() {
  var date = document.getElementById('reportDate').value;
  if (!date) return;
  var el = document.getElementById('dailyReportResult');
  el.innerHTML = '<div class="spinner"></div>';
  callAPI('getDailyReport', { token: session.token, date: date })
    .then(function (r) {
      var statusClass = r.dayStatus.toLowerCase().replace(' ', '');
      var html = '<div class="stat-row"><span>Day Status</span><span class="pill ' + statusClass + '">' + r.dayStatus + '</span></div>' +
        '<div class="stat-row"><span>Total Sales</span><span class="val">₹' + r.totalSales.toFixed(2) + '</span></div>' +
        '<div class="stat-row"><span>Total Expenses</span><span class="val">₹' + r.totalExpenses.toFixed(2) + '</span></div>' +
        '<div class="stat-row"><span>Net</span><span class="val">₹' + (r.totalSales - r.totalExpenses).toFixed(2) + '</span></div>' +
        '<div class="stat-row"><span>Bills</span><span class="val">' + r.billCount + '</span></div>' +
        '<button class="btn secondary" style="margin-top:10px" onclick="downloadDayExcel(\'' + date + '\')">⬇ Download Excel</button>';
      if (r.bills.length > 0) {
        html += '<div style="overflow-x:auto;margin-top:14px"><table class="report-table"><tr><th>Time</th><th>Staff</th><th>Customer</th><th>Mode</th><th>Total</th></tr>' +
          r.bills.map(function (b) {
            return '<tr><td>' + b.time + '</td><td>' + b.staff + '</td><td>' + (b.customer || '-') + '</td><td>' + b.paymentMode + '</td><td>₹' + Number(b.total).toFixed(2) + '</td></tr>';
          }).join('') + '</table></div>';
      }
      el.innerHTML = html;
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') el.innerHTML = 'Error loading report.'; });
}

function loadMonthlyReport() {
  var month = document.getElementById('reportMonth').value;
  if (!month) return;
  var el = document.getElementById('monthlyReportResult');
  el.innerHTML = '<div class="spinner"></div>';
  callAPI('getMonthlyReport', { token: session.token, yearMonth: month })
    .then(function (r) {
      var html = '<div class="stat-row"><span>Days Operated</span><span class="val">' + r.daysOperated + '</span></div>' +
        '<div class="stat-row"><span>Total Sales</span><span class="val">₹' + r.totalSales.toFixed(2) + '</span></div>' +
        '<div class="stat-row"><span>Total Expenses</span><span class="val">₹' + r.totalExpenses.toFixed(2) + '</span></div>' +
        '<div class="stat-row"><span>Net Profit</span><span class="val">₹' + r.netProfit.toFixed(2) + '</span></div>' +
        '<button class="btn secondary" style="margin-top:10px" onclick="downloadMonthExcel(\'' + month + '\')">⬇ Download Excel</button>';
      if (r.days.length > 0) {
        html += '<div style="overflow-x:auto;margin-top:14px"><table class="report-table"><tr><th>Date</th><th>Status</th><th>Sales</th><th>Expenses</th><th>Net</th></tr>' +
          r.days.map(function (d) {
            return '<tr><td>' + d.date + '</td><td>' + d.status + '</td><td>₹' + d.sales.toFixed(2) + '</td><td>₹' + d.expenses.toFixed(2) + '</td><td>₹' + d.net.toFixed(2) + '</td></tr>';
          }).join('') + '</table></div>';
      }
      el.innerHTML = html;
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') el.innerHTML = 'Error loading report.'; });
}

function downloadFile(base64, filename) {
  var link = document.createElement('a');
  link.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + base64;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadDayExcel(date) {
  showToast('Preparing Excel file...');
  callAPI('exportDayToExcel', { token: session.token, date: date })
    .then(function (res) { downloadFile(res.base64, res.filename); })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Export failed: ' + err.message); });
}

function downloadMonthExcel(month) {
  showToast('Preparing Excel file...');
  callAPI('exportMonthToExcel', { token: session.token, yearMonth: month })
    .then(function (res) { downloadFile(res.base64, res.filename); })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Export failed: ' + err.message); });
}

// ---------- ADMIN ----------
function submitNewUser() {
  var fullName = document.getElementById('newUserFullName').value.trim();
  var username = document.getElementById('newUserUsername').value.trim();
  var password = document.getElementById('newUserPassword').value;
  var role = document.getElementById('newUserRole').value;
  if (!fullName || !username || !password) { showToast('Fill all fields.'); return; }
  callAPI('addUser', { token: session.token, username: username, password: password, role: role, fullName: fullName })
    .then(function (res) {
      if (res.success) {
        showToast('User added.');
        document.getElementById('newUserFullName').value = '';
        document.getElementById('newUserUsername').value = '';
        document.getElementById('newUserPassword').value = '';
        loadUsers();
      } else showToast(res.message);
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message); });
}

function loadUsers() {
  callAPI('getUsers', { token: session.token })
    .then(function (list) {
      var el = document.getElementById('usersList');
      el.innerHTML = list.map(function (u) {
        return '<div class="stat-row"><span>' + u.fullName + ' (' + u.username + ') — ' + u.role + '</span>' +
          '<button class="btn small ' + (u.active ? 'danger' : '') + '" onclick="toggleUserActive(\'' + u.username + '\',' + (!u.active) + ')">' + (u.active ? 'Deactivate' : 'Activate') + '</button></div>';
      }).join('');
    })
    .catch(function () {});
}

function toggleUserActive(username, active) {
  callAPI('setUserActive', { token: session.token, username: username, active: active })
    .then(function () { loadUsers(); })
    .catch(function () {});
}

function submitNewQuickItem() {
  var name = document.getElementById('qiName').value.trim();
  var price = document.getElementById('qiPrice').value;
  var unit = document.getElementById('qiUnit').value;
  var category = document.getElementById('qiCategory').value.trim();
  if (!name || !price) { showToast('Enter item name and price.'); return; }
  callAPI('addQuickItem', { token: session.token, name: name, price: price, unit: unit, category: category })
    .then(function () {
      showToast('Quick item added.');
      document.getElementById('qiName').value = '';
      document.getElementById('qiPrice').value = '';
      document.getElementById('qiCategory').value = '';
      loadQuickItemsAdmin();
      loadQuickItems();
    })
    .catch(function (err) { if (err.message !== 'SESSION_EXPIRED') showToast('Error: ' + err.message); });
}

function loadQuickItemsAdmin() {
  callAPI('getQuickItems', { token: session.token })
    .then(function (list) {
      var el = document.getElementById('quickItemsAdminList');
      el.innerHTML = list.map(function (it) {
        return '<div class="stat-row"><span>' + it.ItemName + ' — ₹' + it.DefaultPrice + '/' + it.Unit + '</span>' +
          '<button class="btn small danger" onclick="deleteQI(\'' + it.ItemName + '\')">Delete</button></div>';
      }).join('');
    })
    .catch(function () {});
}

function deleteQI(name) {
  if (!confirm('Delete quick item "' + name + '"?')) return;
  callAPI('deleteQuickItem', { token: session.token, name: name })
    .then(function () { loadQuickItemsAdmin(); loadQuickItems(); })
    .catch(function () {});
}
