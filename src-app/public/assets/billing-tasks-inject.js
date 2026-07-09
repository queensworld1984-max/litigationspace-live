/**
 * billing-tasks-inject.js
 * Injects a "📋 Add Billable Task" button directly into the Billing Dashboard
 * header row (next to "+ Create Invoice" and "+ New Contract").
 * Opens a panel to add tasks with flat-fee / hourly rates and create invoices.
 */
(function () {
  'use strict';

  /* ── Helpers ──────────────────────────────────────────────────────────── */
  function getToken() {
    try { return localStorage.getItem('token') || sessionStorage.getItem('token') || null; }
    catch (e) { return null; }
  }
  function authHeaders() {
    var t = getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t }
             : { 'Content-Type': 'application/json' };
  }
  function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(authHeaders(), opts.headers || {});
    return fetch(path, opts).then(function (r) { return r.json(); });
  }
  function fmt(n) { return '$' + parseFloat(n || 0).toFixed(2); }
  function today() { return new Date().toISOString().split('T')[0]; }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ══════════════════════════════════════════════════════════════════════
     STYLES
  ══════════════════════════════════════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('ls-bt-styles')) return;
    var s = document.createElement('style');
    s.id = 'ls-bt-styles';
    s.textContent = `
      #ls-bt-trigger {
        padding: 8px 16px; border-radius: 8px; border: none;
        background: linear-gradient(135deg,#3b82f6,#6366f1);
        color: #fff; font-size: 0.82rem; font-weight: 700;
        cursor: pointer; white-space: nowrap;
        box-shadow: 0 2px 8px rgba(99,102,241,0.35);
        transition: opacity 0.15s;
      }
      #ls-bt-trigger:hover { opacity: 0.88; }

      #ls-bt-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        z-index: 99999; display: flex; align-items: flex-start;
        justify-content: center; padding: 32px 16px; overflow-y: auto;
      }
      #ls-bt-modal {
        background: #0f172a; border: 1px solid #334155;
        border-radius: 16px; width: 100%; max-width: 760px;
        color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .ls-bt-hdr {
        background: #1e293b; padding: 16px 24px;
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #334155; border-radius: 16px 16px 0 0;
      }
      .ls-bt-hdr h2 { margin: 0; font-size: 1rem; color: #f1f5f9; font-weight: 700; }
      .ls-bt-x { background: none; border: none; color: #94a3b8; font-size: 1.3rem; cursor: pointer; padding: 0 4px; }
      .ls-bt-x:hover { color: #f1f5f9; }
      .ls-bt-body { padding: 20px 24px; }

      .ls-bt-lbl { display: block; font-size: 0.71rem; color: #94a3b8; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 5px; }
      .ls-bt-inp, .ls-bt-sel {
        width: 100%; box-sizing: border-box;
        background: #1e293b; border: 1px solid #334155; border-radius: 8px;
        color: #e2e8f0; padding: 9px 12px; font-size: 0.86rem; outline: none;
      }
      .ls-bt-inp:focus, .ls-bt-sel:focus { border-color: #3b82f6; }

      .ls-bt-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
      .ls-bt-g3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; margin-bottom: 14px; }
      .ls-bt-g1 { margin-bottom: 14px; }
      @media(max-width: 580px) { .ls-bt-g2, .ls-bt-g3 { grid-template-columns: 1fr; } }

      .ls-bt-btn {
        padding: 9px 18px; border-radius: 8px; border: none;
        font-size: 0.84rem; font-weight: 700; cursor: pointer; transition: opacity 0.15s;
      }
      .ls-bt-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .ls-bt-primary { background: linear-gradient(135deg,#3b82f6,#6366f1); color: #fff; }
      .ls-bt-green   { background: linear-gradient(135deg,#059669,#10b981); color: #fff; }
      .ls-bt-amber   { background: linear-gradient(135deg,#d97706,#f59e0b); color: #000; }
      .ls-bt-outline { background: transparent; border: 1px solid #475569 !important; color: #94a3b8; }
      .ls-bt-outline:hover { border-color: #94a3b8 !important; color: #e2e8f0; }

      .ls-bt-tabs { display: flex; border-bottom: 1px solid #334155; margin-bottom: 18px; }
      .ls-bt-tab {
        padding: 8px 16px; font-size: 0.83rem; font-weight: 600; cursor: pointer;
        color: #64748b; border: none; border-bottom: 2px solid transparent;
        background: none; margin-bottom: -1px;
      }
      .ls-bt-tab.on { color: #3b82f6; border-bottom-color: #3b82f6; }

      .ls-bt-row {
        display: flex; align-items: flex-start; gap: 10px;
        background: #1e293b; border: 1px solid #334155; border-radius: 8px;
        padding: 10px 14px; margin-bottom: 8px; font-size: 0.82rem;
      }
      .ls-bt-row-main { flex: 1; }
      .ls-bt-row-title { font-weight: 600; color: #f1f5f9; margin-bottom: 2px; }
      .ls-bt-row-meta { color: #94a3b8; font-size: 0.77rem; }
      .ls-bt-row-amt { color: #34d399; font-weight: 700; font-size: 0.9rem; white-space: nowrap; }

      .ls-bt-msg { padding: 8px 12px; border-radius: 8px; font-size: 0.81rem; margin-top: 10px; }
      .ls-bt-ok  { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.25); }
      .ls-bt-err { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }

      .ls-bt-total { display: flex; justify-content: space-between;
        background: #1e293b; border-radius: 8px; padding: 10px 14px;
        font-weight: 700; margin-top: 12px; }
      .ls-bt-total span:last-child { color: #34d399; }
      .ls-bt-empty { color: #64748b; text-align: center; padding: 20px 0; font-size: 0.84rem; }
      .ls-bt-divider { border: none; border-top: 1px solid #1e293b; margin: 16px 0; }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════════════════════ */
  var S = {
    contracts: [],
    contract: null,
    tasks: [], entries: [],
    tab: 'add',
    saving: false, invoicing: false,
    msg: null, imsg: null,
    f: { title:'', billing_type:'flat_fee', flat_fee_amount:'', hourly_rate:'', estimated_hours:'', description:'', task_date: today() },
    inv: { due_date:'', notes:'', tax_rate:'0', payment_link:'', name:'', email:'' }
  };

  /* ── API ────────────────────────────────────────────────────────────── */
  function loadContracts() {
    return apiFetch('/api/v1/billing/contracts').then(function(d){
      S.contracts = d.contracts||[];
      // Auto-select the only contract so the invoice tab is ready immediately
      if (S.contracts.length === 1 && !S.contract) {
        S.contract = S.contracts[0];
        return loadUnbilled(S.contract.id);
      }
    });
  }
  function loadUnbilled(id) {
    return apiFetch('/api/v1/billing/contracts/'+id+'/tasks/unbilled').then(function(d){
      S.tasks   = d.unbilled_tasks||[];
      S.entries = d.unbilled_time_entries||[];
      S.contract = d.contract || S.contract;
    }).catch(function(){ S.tasks=[]; S.entries=[]; });
  }

  /* ── Add Task ───────────────────────────────────────────────────────── */
  function doAddTask() {
    if (!S.contract || !S.f.title.trim()) return;
    S.saving = true; S.msg = null; render();
    var body = {
      contract_id: S.contract.id,
      title: S.f.title.trim(),
      description: S.f.description.trim(),
      billing_type: S.f.billing_type,
      flat_fee_amount: parseFloat(S.f.flat_fee_amount)||0,
      hourly_rate: parseFloat(S.f.hourly_rate)||0,
      estimated_hours: parseFloat(S.f.estimated_hours)||0,
      task_date: S.f.task_date || today()
    };
    apiFetch('/api/v1/billing/tasks', {method:'POST', body:JSON.stringify(body)})
      .then(function(d){
        S.saving = false;
        if (d.duplicate) {
          S.msg = {ok:false, text:'Task "'+body.title+'" already exists on '+body.task_date+'. Change the title or date to add another.'};
          render();
        } else {
          var rateStr = body.billing_type==='flat_fee' ? fmt(body.flat_fee_amount)+' flat' : body.estimated_hours+'h @ '+fmt(body.hourly_rate)+'/hr';
          S.msg = {ok:true, text:'"'+body.title+'" added — '+rateStr};
          S.f = { title:'', billing_type:S.f.billing_type, flat_fee_amount:'', hourly_rate:S.f.hourly_rate, estimated_hours:'', description:'', task_date:S.f.task_date };
          loadUnbilled(S.contract.id).then(render);
        }
      }).catch(function(){ S.saving=false; S.msg={ok:false,text:'Failed — please try again.'}; render(); });
  }

  /* ── Create Invoice ─────────────────────────────────────────────────── */
  function lineItems() {
    var out = [];
    S.tasks.forEach(function(t){
      if (t.billing_type==='flat_fee' && (t.flat_fee_amount||0)>0)
        out.push({description:t.title+(t.task_date?' ('+t.task_date+')':''), item_type:'flat_fee', quantity:1, rate:t.flat_fee_amount, amount:t.flat_fee_amount, task_id:t.id});
      else if (t.billing_type==='hourly' && (t.hourly_rate||0)>0) {
        var h = t.estimated_hours||0;
        out.push({description:t.title+(t.task_date?' ('+t.task_date+')':''), item_type:'hourly', quantity:h, rate:t.hourly_rate, amount:h*t.hourly_rate, task_id:t.id});
      }
    });
    S.entries.forEach(function(e){
      if ((e.amount||0)>0)
        out.push({description:e.description||'Time entry', item_type:'time', quantity:parseFloat(((e.duration_minutes||0)/60).toFixed(2)), rate:e.hourly_rate||0, amount:e.amount||0, time_entry_id:e.id});
    });
    return out;
  }
  function doCreateInvoice() {
    var items = lineItems();
    if (!items.length){ S.imsg={ok:false,text:'Nothing to invoice — add tasks or log time first.'}; render(); return; }
    S.invoicing=true; S.imsg=null; render();
    var tax = parseFloat(S.inv.tax_rate)||0;
    var sub = items.reduce(function(s,i){return s+(i.amount||0);},0);
    apiFetch('/api/v1/billing/invoices',{method:'POST',body:JSON.stringify({
      contract_id: S.contract.id,
      client_name: S.inv.name||S.contract.client_name,
      client_email: S.inv.email||S.contract.client_email||'',
      due_date: S.inv.due_date||null,
      notes: S.inv.notes||'',
      tax_rate: tax,
      payment_link: S.inv.payment_link||'',
      items: items
    })}).then(function(d){
      S.invoicing=false;
      if (d.id){
        S.imsg={ok:true, text:'Invoice #'+(d.invoice_number||'')+' created for '+fmt(sub+sub*tax/100)+'. Go to the Invoices section above to send it.'};
        loadUnbilled(S.contract.id).then(render);
      } else {
        S.imsg={ok:false, text:d.detail||'Failed to create invoice.'};
        render();
      }
    }).catch(function(){ S.invoicing=false; S.imsg={ok:false,text:'Failed — please try again.'}; render(); });
  }

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  function contractBillingStatus(c) {
    // Returns: 'unbilled' | 'invoiced' | 'none'
    if ((c.unbilled_task_count||0) > 0) return 'unbilled';
    if ((c.invoice_count||0) > 0 && (c.total_task_count||0) > 0) return 'invoiced';
    if ((c.invoice_count||0) > 0) return 'invoiced';
    return 'none';
  }

  function renderContractOpts() {
    var o = '<option value="">— pick a contract —</option>';
    S.contracts.forEach(function(c){
      var sel = S.contract&&S.contract.id===c.id?' selected':'';
      var status = contractBillingStatus(c);
      var badge = status==='unbilled' ? ' ['+c.unbilled_task_count+' unbilled]'
                : status==='invoiced' ? ' ✓ Invoiced'
                : '';
      o += '<option value="'+c.id+'"'+sel+'>'+esc(c.client_name)+' — '+esc(c.title)+badge+'</option>';
    });
    return o;
  }

  function renderAddTab() {
    var f=S.f, h=f.billing_type==='hourly';
    return [
      '<div class="ls-bt-g3">',
        '<div><label class="ls-bt-lbl">Task Title *</label><input class="ls-bt-inp" id="lsf-title" value="'+esc(f.title)+'" placeholder="e.g. Document review, Filing fee, Consultation" /></div>',
        '<div><label class="ls-bt-lbl">Date</label><input type="date" class="ls-bt-inp" id="lsf-date" value="'+f.task_date+'" /></div>',
        '<div><label class="ls-bt-lbl">Billing Type</label><select class="ls-bt-sel" id="lsf-type"><option value="flat_fee"'+(h?'':' selected')+'>Flat Fee</option><option value="hourly"'+(h?' selected':'')+'>Hourly</option></select></div>',
      '</div>',
      '<div class="ls-bt-g2">',
        h ? '<div><label class="ls-bt-lbl">Hourly Rate ($/hr)</label><input type="number" min="0" step="0.01" class="ls-bt-inp" id="lsf-rate" value="'+esc(f.hourly_rate)+'" placeholder="250.00" /></div>'
          : '<div><label class="ls-bt-lbl">Flat Fee Amount ($)</label><input type="number" min="0" step="0.01" class="ls-bt-inp" id="lsf-flat" value="'+esc(f.flat_fee_amount)+'" placeholder="500.00" /></div>',
        h ? '<div><label class="ls-bt-lbl">Hours Spent</label><input type="number" min="0" step="0.25" class="ls-bt-inp" id="lsf-hrs" value="'+esc(f.estimated_hours)+'" placeholder="2.5" /></div>'
          : '<div><label class="ls-bt-lbl">Description (optional)</label><input class="ls-bt-inp" id="lsf-desc" value="'+esc(f.description)+'" placeholder="Brief note" /></div>',
      '</div>',
      h ? '<div class="ls-bt-g1"><label class="ls-bt-lbl">Description (optional)</label><input class="ls-bt-inp" id="lsf-desc" value="'+esc(f.description)+'" placeholder="Brief note" /></div>' : '',
      S.msg ? '<div class="ls-bt-msg '+(S.msg.ok?'ls-bt-ok':'ls-bt-err')+'">'+esc(S.msg.text)+'</div>' : '',
      '<div style="display:flex;gap:10px;margin-top:14px">',
        '<button class="ls-bt-btn ls-bt-green" id="lsf-add"'+(S.saving?' disabled':'')+'>',S.saving?'Adding…':'+ Add This Task','</button>',
        '<button class="ls-bt-btn ls-bt-outline" id="lsf-refresh">↻ Refresh List</button>',
      '</div>'
    ].join('');
  }

  function renderUnbilledTab() {
    if (!S.tasks.length && !S.entries.length) {
      var c = S.contract;
      var alreadyInvoiced = c && (c.invoice_count||0) > 0 && (c.unbilled_task_count||0) === 0;
      if (alreadyInvoiced) {
        return '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:8px;padding:14px 16px;color:#34d399;font-size:0.84rem">'
          +'<strong>✓ All work on this contract has already been invoiced.</strong><br>'
          +'<span style="color:#94a3b8;font-size:0.78rem">There is no unbilled work remaining. Add new tasks on the "Add Task" tab if more work has been done.</span>'
          +'</div>';
      }
      return '<div class="ls-bt-empty">No unbilled tasks or time entries yet for this contract.</div>';
    }
    var h='';
    if (S.tasks.length){
      h+='<div style="font-size:0.73rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">Billable Tasks ('+S.tasks.length+')</div>';
      S.tasks.forEach(function(t){
        var rate=t.billing_type==='flat_fee'?'Flat '+fmt(t.flat_fee_amount):(t.estimated_hours||'?')+'h @ '+fmt(t.hourly_rate)+'/hr';
        var amt=t.billing_type==='flat_fee'?(t.flat_fee_amount||0):(t.estimated_hours||0)*(t.hourly_rate||0);
        h+='<div class="ls-bt-row"><div class="ls-bt-row-main"><div class="ls-bt-row-title">'+esc(t.title)+'</div><div class="ls-bt-row-meta">'+(t.task_date||'')+' · '+rate+(t.description?' · '+esc(t.description):'')+'</div></div><div class="ls-bt-row-amt">'+fmt(amt)+'</div></div>';
      });
    }
    if (S.entries.length){
      h+='<div style="font-size:0.73rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin:'+(S.tasks.length?'14px':'0')+'0 8px">Time Entries ('+S.entries.length+')</div>';
      S.entries.forEach(function(e){
        var hrs=((e.duration_minutes||0)/60).toFixed(2);
        h+='<div class="ls-bt-row"><div class="ls-bt-row-main"><div class="ls-bt-row-title">'+esc(e.description||'Time entry')+'</div><div class="ls-bt-row-meta">'+((e.start_time||'').split('T')[0])+' · '+hrs+'h @ '+fmt(e.hourly_rate)+'/hr</div></div><div class="ls-bt-row-amt">'+fmt(e.amount)+'</div></div>';
      });
    }
    var tot=S.tasks.reduce(function(s,t){return s+(t.billing_type==='flat_fee'?(t.flat_fee_amount||0):(t.estimated_hours||0)*(t.hourly_rate||0));},0)+S.entries.reduce(function(s,e){return s+(e.amount||0);},0);
    h+='<hr class="ls-bt-divider"><div class="ls-bt-total"><span>Total Unbilled</span><span>'+fmt(tot)+'</span></div>';
    return h;
  }

  function renderInvoiceTab() {
    var items=lineItems();
    var sub=items.reduce(function(s,i){return s+(i.amount||0);},0);
    var tax=parseFloat(S.inv.tax_rate)||0;
    var total=sub+sub*tax/100;
    if (!items.length) {
      var c = S.contract;
      var alreadyInvoiced = c && (c.invoice_count||0) > 0 && (c.unbilled_task_count||0) === 0;
      if (alreadyInvoiced) {
        return '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:8px;padding:14px 16px;color:#34d399;font-size:0.84rem">'
          +'<strong>✓ All work on this contract has already been invoiced.</strong><br>'
          +'<span style="color:#94a3b8;font-size:0.78rem">Add new tasks on the "Add Task" tab if there is additional billable work to invoice.</span>'
          +'</div>';
      }
      return '<div class="ls-bt-empty">No unbilled tasks yet. Add tasks on the "Add Task" tab first.</div>';
    }
    var rows=items.map(function(i){
      return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b;font-size:0.81rem"><span style="color:#cbd5e1">'+esc(i.description)+'</span><span style="color:#34d399;font-weight:600">'+fmt(i.amount)+'</span></div>';
    }).join('');
    var c=S.contract;
    var inv=S.inv;
    return [
      '<div style="margin-bottom:14px">',
        '<div style="font-size:0.73rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">'+items.length+' Line Items · Subtotal '+fmt(sub)+'</div>',
        rows,
      '</div>',
      '<div class="ls-bt-g2">',
        '<div><label class="ls-bt-lbl">Bill To Name</label><input class="ls-bt-inp" id="lsi-name" value="'+esc(inv.name||(c?c.client_name:''))+'" placeholder="Client name" /></div>',
        '<div><label class="ls-bt-lbl">Bill To Email</label><input class="ls-bt-inp" id="lsi-email" value="'+esc(inv.email||(c?c.client_email:''))+'" placeholder="client@email.com" /></div>',
      '</div>',
      '<div class="ls-bt-g3">',
        '<div><label class="ls-bt-lbl">Due Date</label><input type="date" class="ls-bt-inp" id="lsi-due" value="'+esc(inv.due_date)+'" /></div>',
        '<div><label class="ls-bt-lbl">Tax %</label><input type="number" min="0" max="100" step="0.1" class="ls-bt-inp" id="lsi-tax" value="'+esc(inv.tax_rate)+'" placeholder="0" /></div>',
        '<div><label class="ls-bt-lbl">Total</label><div style="padding:9px 12px;background:#1e293b;border-radius:8px;color:#34d399;font-weight:700">'+fmt(total)+'</div></div>',
      '</div>',
      '<div class="ls-bt-g1"><label class="ls-bt-lbl">Payment Link (optional)</label><input class="ls-bt-inp" id="lsi-link" value="'+esc(inv.payment_link)+'" placeholder="https://pay.zeffy.com/…" /></div>',
      '<div class="ls-bt-g1"><label class="ls-bt-lbl">Notes (optional)</label><input class="ls-bt-inp" id="lsi-notes" value="'+esc(inv.notes)+'" placeholder="Payment terms, instructions…" /></div>',
      S.imsg?'<div class="ls-bt-msg '+(S.imsg.ok?'ls-bt-ok':'ls-bt-err')+'">'+esc(S.imsg.text)+'</div>':'',
      '<div style="margin-top:14px"><button class="ls-bt-btn ls-bt-amber" id="lsi-create"'+(S.invoicing?' disabled':'')+'>'+(S.invoicing?'Creating…':'🧾 Create Invoice from These Tasks')+'</button></div>'
    ].join('');
  }

  function render() {
    var ov=document.getElementById('ls-bt-overlay'); if(!ov) return;
    var noC=!S.contract;
    var tabs=noC?'':'<div class="ls-bt-tabs">'
      +'<button class="ls-bt-tab'+(S.tab==='add'?' on':'')+'" data-tab="add">+ Add Task</button>'
      +'<button class="ls-bt-tab'+(S.tab==='unbilled'?' on':'')+'" data-tab="unbilled">Unbilled ('+( S.tasks.length+S.entries.length)+')</button>'
      +'<button class="ls-bt-tab'+(S.tab==='invoice'?' on':'')+'" data-tab="invoice">Create Invoice</button>'
      +'</div>';
    var body=noC?'<div class="ls-bt-empty">Select a contract above to begin.</div>'
      :tabs+(S.tab==='add'?renderAddTab():S.tab==='unbilled'?renderUnbilledTab():renderInvoiceTab());

    ov.innerHTML='<div id="ls-bt-modal">'
      +'<div class="ls-bt-hdr"><h2>📋 Add Billable Tasks &amp; Invoice</h2><button class="ls-bt-x" id="ls-bt-x">✕</button></div>'
      +'<div class="ls-bt-body">'
        +'<div class="ls-bt-g1"><label class="ls-bt-lbl">Contract / Client</label>'
          +'<select class="ls-bt-sel" id="lsf-contract">'+renderContractOpts()+'</select>'
        +'</div>'
        +body
      +'</div>'
    +'</div>';
    wire();
  }

  /* ── Event wiring ───────────────────────────────────────────────────── */
  function wire() {
    // Close
    var x=document.getElementById('ls-bt-x'); if(x) x.onclick=close;
    var ov=document.getElementById('ls-bt-overlay');
    if(ov) ov.onclick=function(e){if(e.target===ov)close();};

    // Contract select
    var cs=document.getElementById('lsf-contract');
    if(cs) cs.onchange=function(){
      var id=this.value;
      S.contract=S.contracts.find(function(c){return c.id===id;})||null;
      S.tasks=[]; S.entries=[]; S.msg=null; S.imsg=null;
      if(S.contract) loadUnbilled(S.contract.id).then(render); else render();
    };

    // Tabs
    document.querySelectorAll('.ls-bt-tab').forEach(function(b){
      b.onclick=function(){ S.tab=this.dataset.tab; S.msg=null; S.imsg=null; render(); };
    });

    // Add-task form sync + submit
    function val(id){ var e=document.getElementById(id); return e?e.value:''; }
    function syncForm(){
      S.f.title=val('lsf-title'); S.f.task_date=val('lsf-date');
      S.f.flat_fee_amount=val('lsf-flat'); S.f.hourly_rate=val('lsf-rate');
      S.f.estimated_hours=val('lsf-hrs'); S.f.description=val('lsf-desc');
    }
    var typeEl=document.getElementById('lsf-type');
    if(typeEl) typeEl.onchange=function(){ S.f.billing_type=this.value; render(); };

    var add=document.getElementById('lsf-add');
    if(add) add.onclick=function(){ syncForm(); doAddTask(); };

    var ref=document.getElementById('lsf-refresh');
    if(ref&&S.contract) ref.onclick=function(){ loadUnbilled(S.contract.id).then(render); };

    // Invoice form sync + submit
    function syncInv(){
      S.inv.name=val('lsi-name'); S.inv.email=val('lsi-email');
      S.inv.due_date=val('lsi-due'); S.inv.tax_rate=val('lsi-tax');
      S.inv.payment_link=val('lsi-link'); S.inv.notes=val('lsi-notes');
    }
    var taxEl=document.getElementById('lsi-tax');
    if(taxEl) taxEl.oninput=function(){ S.inv.tax_rate=this.value; render(); };

    var ci=document.getElementById('lsi-create');
    if(ci) ci.onclick=function(){ syncInv(); doCreateInvoice(); };
  }

  /* ── Open / Close ───────────────────────────────────────────────────── */
  function open(startTab) {
    if(!getToken()) return;
    if(document.getElementById('ls-bt-overlay')) return;
    if(startTab) S.tab = startTab;
    var ov=document.createElement('div'); ov.id='ls-bt-overlay';
    document.body.appendChild(ov);
    loadContracts().then(render);
  }
  function close() {
    var el=document.getElementById('ls-bt-overlay'); if(el) el.remove();
  }

  /* ── Intercept the main "+ Create Invoice" button ───────────────────── */
  function interceptCreateInvoiceButtons() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.textContent.trim() === '+ Create Invoice' && !btn.dataset.lsbtHooked) {
        btn.dataset.lsbtHooked = '1';
        btn.addEventListener('click', function(e) {
          e.stopImmediatePropagation();
          e.preventDefault();
          open('invoice');
        }, true);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     DOM INJECTION — find "Billing Dashboard" heading and add the button
  ══════════════════════════════════════════════════════════════════════ */
  var TRIGGER_ID = 'ls-bt-trigger';

  function findBillingHeader() {
    // Walk all elements looking for one whose text is exactly "Billing Dashboard"
    var all = document.querySelectorAll('h1,h2,h3,h4,p,div,span');
    for (var i=0; i<all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && el.textContent.trim() === 'Billing Dashboard') return el;
    }
    return null;
  }

  function injectButton() {
    if (document.getElementById(TRIGGER_ID)) return;
    if (!getToken()) return;

    var heading = findBillingHeader();
    if (!heading) return;

    var btn = document.createElement('button');
    btn.id = TRIGGER_ID;
    btn.textContent = '📋 Add Billable Task';
    btn.onclick = open;

    // Structure: grandparent is the flex row containing [title-block] [buttons-block]
    // heading = h1
    // heading.parentElement = div with h1+p  (title block)
    // heading.parentElement.parentElement = outer flex row (justify-content: space-between)
    // The sibling of the title block is the buttons div — append there
    var titleBlock = heading.parentElement;
    var outerRow   = titleBlock && titleBlock.parentElement;
    var btnBlock   = titleBlock && titleBlock.nextElementSibling;

    if (btnBlock && getComputedStyle(btnBlock).display === 'flex') {
      btnBlock.appendChild(btn);
    } else if (outerRow) {
      outerRow.appendChild(btn);
    } else {
      heading.insertAdjacentElement('afterend', btn);
    }
  }

  function cleanup() {
    var btn = document.getElementById(TRIGGER_ID);
    if (btn) btn.remove();
    close();
  }

  /* ── Watch DOM for billing page ─────────────────────────────────────── */
  function init() {
    injectStyles();

    var observer = new MutationObserver(function() {
      var onBilling = window.location.pathname.startsWith('/billing');
      if (onBilling && getToken()) {
        injectButton();
        interceptCreateInvoiceButtons();
      } else {
        cleanup();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also handle SPA navigation
    var orig = history.pushState;
    history.pushState = function() { orig.apply(history, arguments); setTimeout(function(){ if(!window.location.pathname.startsWith('/billing')) cleanup(); }, 300); };
    window.addEventListener('popstate', function(){ if(!window.location.pathname.startsWith('/billing')) cleanup(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
