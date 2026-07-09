/**
 * billing-inject.js — Billable Tasks & Invoice panel for /dashboard/billing
 */
(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function tok() {
    try { return localStorage.getItem('token') || sessionStorage.getItem('token') || ''; }
    catch(e) { return ''; }
  }
  function hdrs() { return {'Content-Type':'application/json','Authorization':'Bearer '+tok()}; }
  function api(url, opts) {
    return fetch(url, Object.assign({headers:hdrs()}, opts||{})).then(function(r){return r.json();});
  }
  function $(id) { return document.getElementById(id); }
  function val(id) { var e=$(id); return e ? e.value.trim() : ''; }
  function fmt(n) { return '$'+parseFloat(n||0).toFixed(2); }
  function today() { return new Date().toISOString().split('T')[0]; }
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function showMsg(id, ok, text) {
    var el=$(id); if(!el) return;
    el.style.cssText = 'display:'+(text?'block':'none')+';padding:7px 11px;border-radius:7px;font-size:0.81rem;margin-top:8px;'
      +'color:'+(ok?'#34d399':'#f87171')+';background:'+(ok?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)')+';'
      +'border:1px solid '+(ok?'rgba(16,185,129,0.3)':'rgba(239,68,68,0.3)')+';';
    el.textContent = text;
  }

  /* ── State ───────────────────────────────────────────────────────────── */
  var contracts   = [];
  var taskCache   = {};   // contractId → tasks[]
  var selectedIds = {};   // taskId    → task object
  var startTab    = 'add';

  /* ── Styles ──────────────────────────────────────────────────────────── */
  function addStyles() {
    if ($('lsbt-css')) return;
    var s = document.createElement('style'); s.id = 'lsbt-css';
    s.textContent = [
      '#lsbt-btn{padding:8px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;font-size:.82rem;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(99,102,241,.4)}',
      '#lsbt-btn:hover{opacity:.85}',
      '#lsbt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto;box-sizing:border-box}',
      '#lsbt-box{background:#0f172a;border:1px solid #334155;border-radius:14px;width:100%;max-width:740px;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;flex-shrink:0}',
      '.lsbt-hdr{background:#1e293b;padding:14px 22px;border-radius:14px 14px 0 0;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center}',
      '.lsbt-hdr h3{margin:0;font-size:.98rem;color:#f1f5f9}',
      '.lsbt-x{background:none;border:none;color:#94a3b8;font-size:1.25rem;cursor:pointer}',
      '.lsbt-x:hover{color:#f1f5f9}',
      '.lsbt-body{padding:18px 22px}',
      '.lsbt-lbl{display:block;font-size:.7rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px}',
      '.lsbt-inp,.lsbt-sel{width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:7px;color:#e2e8f0;padding:8px 11px;font-size:.85rem;outline:none}',
      '.lsbt-inp:focus,.lsbt-sel:focus{border-color:#3b82f6}',
      '.lsbt-row{margin-bottom:13px}',
      '.lsbt-g2{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:13px}',
      '.lsbt-g3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:11px;margin-bottom:13px}',
      '@media(max-width:520px){.lsbt-g2,.lsbt-g3{grid-template-columns:1fr}}',
      '.lsbt-btn{padding:8px 18px;border-radius:7px;border:none;font-size:.84rem;font-weight:700;cursor:pointer}',
      '.lsbt-btn:disabled{opacity:.4;cursor:not-allowed}',
      '.lsbt-green{background:linear-gradient(135deg,#059669,#10b981);color:#fff}',
      '.lsbt-amber{background:linear-gradient(135deg,#d97706,#f59e0b);color:#000}',
      '.lsbt-ghost{background:transparent;border:1px solid #475569!important;color:#94a3b8}',
      '.lsbt-tabs{display:flex;border-bottom:1px solid #334155;margin-bottom:16px}',
      '.lsbt-tab{padding:7px 15px;font-size:.82rem;font-weight:600;cursor:pointer;color:#64748b;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px}',
      '.lsbt-tab.on{color:#3b82f6;border-bottom-color:#3b82f6}',
      '.lsbt-hr{border:none;border-top:1px solid #1e293b;margin:14px 0}',
      '.lsbt-empty{color:#64748b;text-align:center;padding:14px 0;font-size:.83rem}',

      /* ── contract group ── */
      '.lsg{border:1px solid #1e293b;border-radius:9px;margin-bottom:10px;overflow:hidden}',
      '.lsg-hdr{background:#1e293b;padding:10px 14px;display:flex;align-items:center;justify-content:space-between}',
      '.lsg-title{font-size:.86rem;font-weight:700;color:#f1f5f9}',
      '.lsg-client{font-size:.75rem;color:#64748b;margin-top:1px}',
      '.lsg-badge{font-size:.69rem;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap}',
      '.lsg-badge-u{background:rgba(59,130,246,.18);color:#60a5fa}',
      '.lsg-badge-i{background:rgba(16,185,129,.15);color:#34d399}',
      '.lsg-selall{font-size:.72rem;font-weight:700;color:#3b82f6;cursor:pointer;padding:2px 7px;border-radius:4px;white-space:nowrap;margin-right:6px}',
      '.lsg-selall:hover{background:rgba(59,130,246,.12)}',

      /* ── task row ── */
      '.lst{display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-top:1px solid #0f172a;cursor:pointer;transition:background .1s;user-select:none}',
      '.lst:hover{background:#0d1e35}',
      '.lst.on{background:rgba(59,130,246,.1)}',
      '.lst-cb{width:16px;height:16px;border:2px solid #334155;border-radius:4px;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center}',
      '.lst.on .lst-cb{background:#3b82f6;border-color:#3b82f6}',
      '.lst-body{flex:1;min-width:0}',
      '.lst-name{font-size:.83rem;font-weight:600;color:#e2e8f0}',
      '.lst-meta{font-size:.74rem;color:#64748b;margin-top:2px}',
      '.lst-amt{font-size:.84rem;font-weight:700;color:#34d399;white-space:nowrap;margin-left:6px}',
      '.lst-load{padding:10px 14px;font-size:.8rem;color:#64748b;font-style:italic}',

      /* ── invoiced section ── */
      '.lsi-section{margin-top:6px;border:1px solid #1e293b;border-radius:9px;overflow:hidden}',
      '.lsi-hdr{background:#0a1020;padding:7px 14px;font-size:.69rem;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.07em}',
      '.lsi-row{padding:7px 14px;font-size:.79rem;color:#475569;border-top:1px solid #0f172a}',

      /* ── selected items panel ── */
      '.lsip{border:1px solid #334155;border-radius:8px;background:#060e1a;margin-bottom:14px}',
      '.lsip-empty{color:#475569;text-align:center;padding:13px;font-size:.82rem}',
      '.lsip-row{display:flex;align-items:center;padding:7px 12px;border-top:1px solid #0f172a;font-size:.81rem}',
      '.lsip-desc{flex:1;color:#cbd5e1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:8px}',
      '.lsip-amt{color:#34d399;font-weight:700;white-space:nowrap}',
      '.lsip-rm{background:none;border:none;color:#475569;cursor:pointer;font-size:.9rem;padding:0 0 0 8px;line-height:1}',
      '.lsip-rm:hover{color:#f87171}',
      '.lsip-total{display:flex;justify-content:space-between;padding:8px 12px;border-top:1px solid #334155;font-weight:700;font-size:.85rem}',
      '.lsip-total span:last-child{color:#34d399}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── API ─────────────────────────────────────────────────────────────── */
  function loadContracts(cb) {
    api('/api/v1/billing/contracts').then(function(d){
      contracts = d.contracts||[]; cb();
    }).catch(function(){ contracts=[]; cb(); });
  }

  function loadTasks(cid, cb) {
    if (taskCache[cid] !== undefined) { cb(taskCache[cid]); return; }
    taskCache[cid] = null; // mark loading
    api('/api/v1/billing/contracts/'+cid+'/tasks/unbilled').then(function(d){
      taskCache[cid] = d.unbilled_tasks||[];
      cb(taskCache[cid]);
    }).catch(function(){ taskCache[cid]=[]; cb([]); });
  }

  /* ── Task helpers ────────────────────────────────────────────────────── */
  function taskAmt(t) {
    return t.billing_type==='flat_fee' ? (t.flat_fee_amount||0) : (t.estimated_hours||0)*(t.hourly_rate||0);
  }
  function taskRateStr(t) {
    return t.billing_type==='flat_fee'
      ? 'Flat fee'
      : (t.estimated_hours||0)+'h × '+fmt(t.hourly_rate||0)+'/hr';
  }
  var CHECK_SVG = '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ── Open / Close ────────────────────────────────────────────────────── */
  function open(tab) {
    if (!tok()) { alert('Please log in first.'); return; }
    if ($('lsbt-overlay')) return;
    startTab = tab||'add';
    var ov = document.createElement('div'); ov.id='lsbt-overlay';
    document.body.appendChild(ov);
    loadContracts(function(){
      ov.innerHTML = buildModal();
      wire();
      // Auto-load tasks for all unbilled contracts when invoice tab opens
      if (startTab==='invoice') loadAllTasksForTree();
    });
  }
  function close() { var el=$('lsbt-overlay'); if(el) el.remove(); }

  /* ── Load all tasks for the tree upfront ─────────────────────────────── */
  function loadAllTasksForTree() {
    var toLoad = contracts.filter(function(c){ return (c.unbilled_task_count||0)>0 && taskCache[c.id]===undefined; });
    if (!toLoad.length) return;
    var done = 0;
    toLoad.forEach(function(c){
      loadTasks(c.id, function(){
        done++;
        // Refresh just this contract's task section
        var tasksDiv = $('lt-tasks-'+c.id);
        if (tasksDiv) tasksDiv.innerHTML = buildTaskRows(c.id);
        wireTasksIn(c.id);
        // When all done, also refresh the select-all buttons
        if (done===toLoad.length) refreshSelectAllBtns();
      });
    });
  }

  /* ── Modal ───────────────────────────────────────────────────────────── */
  function buildModal() {
    var tab = startTab;
    return '<div id="lsbt-box">'
      +'<div class="lsbt-hdr"><h3>📋 Add Billable Tasks &amp; Invoice</h3><button class="lsbt-x" id="lsbt-close">✕</button></div>'
      +'<div class="lsbt-body">'
      +'<div class="lsbt-tabs">'
      +'<button class="lsbt-tab'+(tab==='add'?' on':'')+'" data-tab="add">+ Add Task</button>'
      +'<button class="lsbt-tab'+(tab==='invoice'?' on':'')+'" data-tab="invoice">Create Invoice</button>'
      +'</div>'
      +'<div id="tab-add"     style="display:'+(tab==='add'    ?'block':'none')+'">'+buildAddTab()+'</div>'
      +'<div id="tab-invoice" style="display:'+(tab==='invoice'?'block':'none')+'">'+buildInvoiceTab()+'</div>'
      +'</div></div>';
  }

  /* ── ADD TASK TAB ────────────────────────────────────────────────────── */
  function buildAddTab() {
    // Simple contract dropdown — just existing contracts, clean names only
    var opts = '<option value="">— Select a contract —</option>';
    contracts.forEach(function(c){
      opts += '<option value="'+c.id+'">'+esc(c.title)+' ('+esc(c.client_name)+')</option>';
    });
    return '<div class="lsbt-row"><label class="lsbt-lbl">Select Contract *</label>'
      +'<select class="lsbt-sel" id="lsbt-contract">'+opts+'</select></div>'
      +'<div class="lsbt-g3">'
        +'<div><label class="lsbt-lbl">Task Title *</label><input class="lsbt-inp" id="lsbt-title" placeholder="e.g. Document review"></div>'
        +'<div><label class="lsbt-lbl">Date</label><input type="date" class="lsbt-inp" id="lsbt-date" value="'+today()+'"></div>'
        +'<div><label class="lsbt-lbl">Billing Type</label>'
          +'<select class="lsbt-sel" id="lsbt-type">'
            +'<option value="flat_fee">Flat Fee</option>'
            +'<option value="hourly">Hourly</option>'
          +'</select>'
        +'</div>'
      +'</div>'
      +'<div class="lsbt-g2">'
        +'<div><label class="lsbt-lbl">Flat Fee ($)</label><input type="number" min="0" step="0.01" class="lsbt-inp" id="lsbt-flat" placeholder="500.00"></div>'
        +'<div><label class="lsbt-lbl">Hourly Rate &amp; Hours</label>'
          +'<div style="display:flex;gap:6px">'
            +'<input type="number" min="0" step="0.01" class="lsbt-inp" id="lsbt-rate" placeholder="$250/hr" style="flex:1">'
            +'<input type="number" min="0" step="0.25" class="lsbt-inp" id="lsbt-hrs" placeholder="hrs" style="flex:1">'
          +'</div>'
        +'</div>'
      +'</div>'
      +'<div class="lsbt-row"><label class="lsbt-lbl">Description (optional)</label><input class="lsbt-inp" id="lsbt-desc" placeholder="Brief note"></div>'
      +'<div id="lsbt-add-msg"></div>'
      +'<div style="margin-top:13px">'
        +'<button class="lsbt-btn lsbt-green" id="lsbt-add-btn">+ Add This Task</button>'
      +'</div>';
  }

  /* ── CREATE INVOICE TAB ──────────────────────────────────────────────── */
  function buildInvoiceTab() {
    return '<div style="font-size:.72rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Select Tasks to Invoice</div>'
      +'<div id="lt-tree">'+buildTree()+'</div>'
      +'<div style="font-size:.72rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 7px">Invoice Items <span id="lt-sel-cnt" style="color:#3b82f6;font-weight:400">('+Object.keys(selectedIds).length+' selected)</span></div>'
      +'<div class="lsip" id="lt-items">'+buildItemsPanel()+'</div>'
      +'<hr class="lsbt-hr">'
      +'<div class="lsbt-g2">'
        +'<div><label class="lsbt-lbl">Bill To Name</label><input class="lsbt-inp" id="lsbt-iname" placeholder="Client name"></div>'
        +'<div><label class="lsbt-lbl">Bill To Email</label><input class="lsbt-inp" id="lsbt-iemail" placeholder="client@email.com"></div>'
      +'</div>'
      +'<div class="lsbt-g3">'
        +'<div><label class="lsbt-lbl">Due Date</label><input type="date" class="lsbt-inp" id="lsbt-idue"></div>'
        +'<div><label class="lsbt-lbl">Tax %</label><input type="number" min="0" max="100" step="0.1" class="lsbt-inp" id="lsbt-itax" value="0"></div>'
        +'<div><label class="lsbt-lbl">Total</label><div style="padding:8px 11px;background:#1e293b;border-radius:7px;color:#34d399;font-weight:700" id="lsbt-itotal">$0.00</div></div>'
      +'</div>'
      +'<div class="lsbt-row"><label class="lsbt-lbl">Payment Link</label><input class="lsbt-inp" id="lsbt-ilink" placeholder="https://pay.zeffy.com/…"></div>'
      +'<div class="lsbt-row"><label class="lsbt-lbl">Notes</label><input class="lsbt-inp" id="lsbt-inotes" placeholder="Payment terms…"></div>'
      +'<div id="lsbt-inv-msg"></div>'
      +'<div style="margin-top:13px"><button class="lsbt-btn lsbt-amber" id="lsbt-inv-btn">🧾 Create Invoice</button></div>';
  }

  /* ── Contract tree ───────────────────────────────────────────────────── */
  function buildTree() {
    var unbilled = contracts.filter(function(c){ return (c.unbilled_task_count||0)>0; });
    var invoiced  = contracts.filter(function(c){ return (c.unbilled_task_count||0)===0 && (c.invoice_count||0)>0; });

    if (!contracts.length) return '<div class="lsbt-empty">No contracts found.</div>';

    var h = '';

    if (!unbilled.length) {
      h += '<div class="lsbt-empty">No contracts with unbilled tasks.</div>';
    } else {
      unbilled.forEach(function(c){
        var tasks = taskCache[c.id];   // null=loading, undefined=not started, []=empty
        var allSel = tasks && tasks.length && tasks.every(function(t){ return !!selectedIds[t.id]; });
        h += '<div class="lsg">'
          // Contract header
          +'<div class="lsg-hdr">'
            +'<div>'
              +'<div class="lsg-title">'+esc(c.title)+'</div>'
              +'<div class="lsg-client">'+esc(c.client_name)+'</div>'
            +'</div>'
            +'<div style="display:flex;align-items:center;gap:6px">';
        if (tasks && tasks.length) {
          h += '<span class="lsg-selall" data-cid-all="'+c.id+'">'+( allSel?'Deselect All':'Select All')+'</span>';
        }
        h += '<span class="lsg-badge lsg-badge-u">'+c.unbilled_task_count+' unbilled</span>'
            +'</div>'
          +'</div>'
          // Task rows
          +'<div id="lt-tasks-'+c.id+'">'+buildTaskRows(c.id)+'</div>'
          +'</div>';
      });
    }

    if (invoiced.length) {
      h += '<div class="lsi-section">'
        +'<div class="lsi-hdr">Already Invoiced — no new tasks</div>';
      invoiced.forEach(function(c){
        h += '<div class="lsi-row">✓ '+esc(c.title)+' · '+esc(c.client_name)+'</div>';
      });
      h += '</div>';
    }

    return h;
  }

  function buildTaskRows(cid) {
    var tasks = taskCache[cid];
    if (tasks === null) return '<div class="lst-load">Loading tasks…</div>';
    if (tasks === undefined) return '<div class="lst-load">Loading tasks…</div>';
    if (!tasks.length) return '<div class="lsbt-empty" style="padding:10px 0">No unbilled tasks for this contract.</div>';
    var h = '';
    tasks.forEach(function(t){
      var sel = !!selectedIds[t.id];
      var amt = taskAmt(t);
      h += '<div class="lst'+(sel?' on':'')+'" data-tid="'+t.id+'" data-cid="'+cid+'">'
        +'<div class="lst-cb">'+(sel?CHECK_SVG:'')+'</div>'
        +'<div class="lst-body">'
          +'<div class="lst-name">'+esc(t.title)+'</div>'
          +'<div class="lst-meta">'+(t.task_date?t.task_date+' · ':'')+taskRateStr(t)+'</div>'
        +'</div>'
        +'<div class="lst-amt">'+fmt(amt)+'</div>'
        +'</div>';
    });
    return h;
  }

  /* ── Items panel ─────────────────────────────────────────────────────── */
  function buildItemsPanel() {
    var keys = Object.keys(selectedIds);
    if (!keys.length) return '<div class="lsip-empty">Click tasks above to add them here.</div>';
    var tax = parseFloat(($('lsbt-itax')&&$('lsbt-itax').value)||0);
    var sub = 0;
    var h = '';
    keys.forEach(function(tid){
      var t = selectedIds[tid], amt = taskAmt(t);
      sub += amt;
      h += '<div class="lsip-row">'
        +'<span class="lsip-desc">'+esc(t.title)+(t.task_date?' ('+t.task_date+')':'')+'</span>'
        +'<span class="lsip-amt">'+fmt(amt)+'</span>'
        +'<button class="lsip-rm" data-rm="'+tid+'">×</button>'
        +'</div>';
    });
    h += '<div class="lsip-total"><span>Subtotal</span><span>'+fmt(sub)+'</span></div>';
    if (tax>0) {
      h += '<div class="lsip-total" style="font-weight:400;font-size:.76rem;color:#94a3b8"><span>Tax ('+tax+'%)</span><span>'+fmt(sub*tax/100)+'</span></div>';
    }
    return h;
  }

  function refreshItems() {
    var panel = $('lt-items'), cnt = $('lt-sel-cnt'), total = $('lsbt-itotal');
    if (panel) panel.innerHTML = buildItemsPanel();
    var n = Object.keys(selectedIds).length;
    if (cnt)   cnt.textContent = '('+n+' selected)';
    var tax = parseFloat(($('lsbt-itax')&&$('lsbt-itax').value)||0);
    var sub = Object.keys(selectedIds).reduce(function(s,tid){ return s+taskAmt(selectedIds[tid]); }, 0);
    if (total) total.textContent = fmt(sub+sub*tax/100);
    wireItemRemove();
  }

  /* ── Toggle task ─────────────────────────────────────────────────────── */
  function toggleTask(tid, cid) {
    var tasks = taskCache[cid]||[];
    var t = tasks.find(function(x){ return x.id===tid; });
    if (!t) return;

    if (selectedIds[tid]) {
      delete selectedIds[tid];
    } else {
      selectedIds[tid] = t;
      // Auto-fill bill-to if empty
      var c = contracts.find(function(x){ return x.id===cid; });
      if (c) {
        var nm=$('lsbt-iname'), em=$('lsbt-iemail');
        if (nm&&!nm.value) nm.value = c.client_name||'';
        if (em&&!em.value) em.value = c.client_email||'';
      }
    }

    // Update task row style in-place
    var row = document.querySelector('.lst[data-tid="'+tid+'"]');
    if (row) {
      var sel = !!selectedIds[tid];
      row.classList.toggle('on', sel);
      var cb = row.querySelector('.lst-cb');
      if (cb) cb.innerHTML = sel ? CHECK_SVG : '';
    }
    // Update Select All button label
    refreshSelectAllBtnFor(cid);
    refreshItems();
  }

  /* ── Select All / Deselect All ───────────────────────────────────────── */
  function toggleAll(cid) {
    var tasks = taskCache[cid]||[];
    if (!tasks.length) return;
    var allSel = tasks.every(function(t){ return !!selectedIds[t.id]; });
    tasks.forEach(function(t){
      if (allSel) delete selectedIds[t.id]; else selectedIds[t.id]=t;
    });
    if (!allSel) {
      var c = contracts.find(function(x){ return x.id===cid; });
      if (c) {
        var nm=$('lsbt-iname'), em=$('lsbt-iemail');
        if (nm&&!nm.value) nm.value = c.client_name||'';
        if (em&&!em.value) em.value = c.client_email||'';
      }
    }
    // Redraw task rows
    var wrap = $('lt-tasks-'+cid);
    if (wrap) { wrap.innerHTML=buildTaskRows(cid); wireTasksIn(cid); }
    refreshSelectAllBtnFor(cid);
    refreshItems();
  }

  function refreshSelectAllBtnFor(cid) {
    var btn = document.querySelector('[data-cid-all="'+cid+'"]'); if(!btn) return;
    var tasks = taskCache[cid]||[];
    var allSel = tasks.length && tasks.every(function(t){ return !!selectedIds[t.id]; });
    btn.textContent = allSel ? 'Deselect All' : 'Select All';
  }
  function refreshSelectAllBtns() {
    document.querySelectorAll('[data-cid-all]').forEach(function(btn){
      refreshSelectAllBtnFor(btn.dataset.cidAll);
    });
  }

  /* ── Wire task rows ──────────────────────────────────────────────────── */
  function wireTasksIn(cid) {
    var wrap = $('lt-tasks-'+cid); if(!wrap) return;
    wrap.querySelectorAll('.lst').forEach(function(row){
      row.onclick = function(){ toggleTask(this.dataset.tid, this.dataset.cid); };
    });
  }
  function wireItemRemove() {
    var panel = $('lt-items'); if(!panel) return;
    panel.querySelectorAll('[data-rm]').forEach(function(btn){
      btn.onclick = function(e){
        e.stopPropagation();
        var tid = this.dataset.rm;
        delete selectedIds[tid];
        var row = document.querySelector('.lst[data-tid="'+tid+'"]');
        if (row) {
          row.classList.remove('on');
          var cb=row.querySelector('.lst-cb'); if(cb) cb.innerHTML='';
          refreshSelectAllBtnFor(row.dataset.cid);
        }
        refreshItems();
      };
    });
  }

  /* ── Build line items for POST ───────────────────────────────────────── */
  function buildLineItems() {
    var out = [];
    Object.keys(selectedIds).forEach(function(tid){
      var t = selectedIds[tid], amt = taskAmt(t);
      if (amt<=0) return;
      if (t.billing_type==='flat_fee') {
        out.push({description:t.title+(t.task_date?' ('+t.task_date+')':''),item_type:'flat_fee',quantity:1,rate:t.flat_fee_amount,amount:t.flat_fee_amount,task_id:t.id});
      } else {
        var h=t.estimated_hours||0;
        out.push({description:t.title+(t.task_date?' ('+t.task_date+')':''),item_type:'hourly',quantity:h,rate:t.hourly_rate,amount:h*(t.hourly_rate||0),task_id:t.id});
      }
    });
    return out;
  }

  /* ── Wire the modal ──────────────────────────────────────────────────── */
  function wire() {
    $('lsbt-close').onclick = close;
    $('lsbt-overlay').onclick = function(e){ if(e.target===this) close(); };

    // Tabs
    document.querySelectorAll('.lsbt-tab').forEach(function(b){
      b.onclick = function(){
        var name = this.dataset.tab;
        document.querySelectorAll('.lsbt-tab').forEach(function(x){ x.classList.toggle('on',x.dataset.tab===name); });
        var add=$('tab-add'), inv=$('tab-invoice');
        if(add) add.style.display = name==='add'    ?'block':'none';
        if(inv) inv.style.display = name==='invoice'?'block':'none';
        if (name==='invoice') loadAllTasksForTree();
      };
    });

    // Tree: Select All buttons
    document.querySelectorAll('[data-cid-all]').forEach(function(btn){
      btn.onclick = function(e){ e.stopPropagation(); toggleAll(this.dataset.cidAll); };
    });

    // Tree: task rows (already-loaded ones)
    Object.keys(taskCache).forEach(function(cid){ if(taskCache[cid]) wireTasksIn(cid); });

    // Tax input
    var taxEl=$('lsbt-itax'); if(taxEl) taxEl.oninput=refreshItems;

    // Item remove buttons (initial)
    wireItemRemove();

    // Add Task submit
    var addBtn=$('lsbt-add-btn');
    if (addBtn) addBtn.onclick = function(){
      var cid=val('lsbt-contract'), title=val('lsbt-title');
      var btype=$('lsbt-type').value;
      var flat=parseFloat($('lsbt-flat').value)||0;
      var rate=parseFloat($('lsbt-rate').value)||0;
      var hrs=parseFloat($('lsbt-hrs').value)||0;
      var tdate=$('lsbt-date').value||today(), desc=val('lsbt-desc');
      if (!cid)   { showMsg('lsbt-add-msg',false,'Select a contract first.'); return; }
      if (!title) { showMsg('lsbt-add-msg',false,'Enter a task title.'); return; }
      if (btype==='flat_fee'&&flat<=0) { showMsg('lsbt-add-msg',false,'Enter a flat fee amount greater than $0.'); return; }
      if (btype==='hourly'&&rate<=0)   { showMsg('lsbt-add-msg',false,'Enter an hourly rate.'); return; }
      var btn=$('lsbt-add-btn'); btn.disabled=true; btn.textContent='Adding…';
      api('/api/v1/billing/tasks',{method:'POST',body:JSON.stringify({
        contract_id:cid, title:title, description:desc, billing_type:btype,
        flat_fee_amount:flat, hourly_rate:rate, estimated_hours:hrs, task_date:tdate
      })}).then(function(d){
        btn.disabled=false; btn.textContent='+ Add This Task';
        if (d.duplicate) {
          showMsg('lsbt-add-msg',false,'"'+title+'" already logged on '+tdate+'. Change the title or date.');
        } else if (d.id) {
          showMsg('lsbt-add-msg',true,'✓ "'+title+'" added successfully.');
          $('lsbt-title').value=''; $('lsbt-flat').value=''; $('lsbt-hrs').value=''; $('lsbt-desc').value='';
          // Bust task cache for this contract so the tree reloads it fresh
          delete taskCache[cid];
          var c = contracts.find(function(x){return x.id===cid;});
          if (c) c.unbilled_task_count = (c.unbilled_task_count||0)+1;
        } else {
          showMsg('lsbt-add-msg',false,d.detail||'Error adding task.');
        }
      }).catch(function(){ btn.disabled=false; btn.textContent='+ Add This Task'; showMsg('lsbt-add-msg',false,'Network error.'); });
    };

    // Create Invoice submit
    var invBtn=$('lsbt-inv-btn');
    if (invBtn) invBtn.onclick = function(){
      var items = buildLineItems();
      if (!items.length) { showMsg('lsbt-inv-msg',false,'Select at least one task above.'); return; }
      // Determine contract_id from first selected task
      var firstTid = Object.keys(selectedIds)[0];
      var primaryCid = '';
      Object.keys(taskCache).forEach(function(cid){
        var tc = taskCache[cid]||[];
        if (tc.find(function(t){return t.id===firstTid;})) primaryCid=cid;
      });
      var tax=parseFloat($('lsbt-itax').value)||0;
      var sub=items.reduce(function(s,i){return s+i.amount;},0);
      var btn=$('lsbt-inv-btn'); btn.disabled=true; btn.textContent='Creating…';
      showMsg('lsbt-inv-msg',true,'');
      api('/api/v1/billing/invoices',{method:'POST',body:JSON.stringify({
        contract_id:primaryCid,
        client_name:val('lsbt-iname'), client_email:val('lsbt-iemail'),
        due_date:$('lsbt-idue').value||null, notes:val('lsbt-inotes'),
        tax_rate:tax, payment_link:val('lsbt-ilink'), items:items
      })}).then(function(d){
        btn.disabled=false; btn.textContent='🧾 Create Invoice';
        if (d.id) {
          showMsg('lsbt-inv-msg',true,'✓ Invoice #'+(d.invoice_number||'')+' created — '+fmt(sub+sub*tax/100)+'.');
          // Clear selections and refresh
          selectedIds={};
          Object.keys(taskCache).forEach(function(k){ delete taskCache[k]; });
          loadContracts(function(){
            var tree=$('lt-tree'); if(tree){ tree.innerHTML=buildTree(); }
            document.querySelectorAll('[data-cid-all]').forEach(function(btn2){
              btn2.onclick=function(e){ e.stopPropagation(); toggleAll(this.dataset.cidAll); };
            });
            refreshItems();
            loadAllTasksForTree();
          });
        } else { showMsg('lsbt-inv-msg',false,d.detail||'Failed to create invoice.'); }
      }).catch(function(){ btn.disabled=false; btn.textContent='🧾 Create Invoice'; showMsg('lsbt-inv-msg',false,'Network error.'); });
    };
  }

  /* ── Replace the React "Create Invoice" button ───────────────────────── */
  function replaceCreateInvoiceButtons() {
    document.querySelectorAll('button').forEach(function(btn){
      if (btn.textContent.trim()!=='+ Create Invoice' || btn.dataset.lsbtReplaced) return;
      btn.dataset.lsbtReplaced='1';
      // Clone appearance, swap function
      var clone = document.createElement('button');
      clone.textContent = '+ Create Invoice';
      // Copy inline styles and classes from original
      clone.style.cssText = btn.style.cssText;
      clone.className     = btn.className;
      // Ensure the clone looks exactly like the original via computed style
      var cs = window.getComputedStyle(btn);
      ['padding','borderRadius','border','background','color','fontSize','fontWeight',
       'lineHeight','cursor','boxShadow','transition'].forEach(function(p){
        clone.style[p] = cs[p];
      });
      clone.onclick = function(){ open('invoice'); };
      btn.style.display = 'none';
      btn.insertAdjacentElement('afterend', clone);
    });
  }

  /* ── DOM injection ───────────────────────────────────────────────────── */
  var injected = false;

  function tryInject() {
    var onBilling = window.location.pathname.startsWith('/dashboard/billing');
    if (!onBilling || !tok()) return;
    replaceCreateInvoiceButtons();
    if (injected) return;
    var h1 = null;
    document.querySelectorAll('h1').forEach(function(el){
      if (el.textContent.trim()==='Billing Dashboard') h1=el;
    });
    if (!h1) return;
    var btn = document.createElement('button');
    btn.id='lsbt-btn'; btn.textContent='📋 Add Billable Task';
    btn.onclick = function(){ open('add'); };
    var sib = h1.parentElement && h1.parentElement.nextElementSibling;
    if (sib) sib.appendChild(btn); else h1.parentElement.appendChild(btn);
    injected = true;
  }

  function onNav() {
    if (!window.location.pathname.startsWith('/dashboard/billing') && injected) {
      var b=$('lsbt-btn'); if(b) b.remove();
      injected=false; close();
    }
    tryInject();
  }

  function boot() {
    addStyles();
    new MutationObserver(tryInject).observe(document.body,{childList:true,subtree:true});
    var op = history.pushState;
    history.pushState = function(){ op.apply(history,arguments); setTimeout(onNav,400); };
    window.addEventListener('popstate', function(){ setTimeout(onNav,400); });
    setTimeout(tryInject, 1000);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
