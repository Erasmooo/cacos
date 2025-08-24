/* ========================================================================== *
 * CACOS • storage.js
 * localStorage + API utilitária (clientes, processos, créditos, pagamentos)
 * Com baseline DEMO determinístico (5 clientes, ~10 processos, 6–8 loans)
 * ========================================================================== */

(function(){
  // --------------------------- Constantes & Helpers ------------------------
  const VERSION_KEY = 'cacos_schema_version';
  const VERSION = 4; // incrementa ao mudar schema
  const DB = {
    clients:   'cacos_clients',
    processes: 'cacos_processes',
    loans:     'cacos_loans',
    payments:  'cacos_payments',
  };

  const load = (k) => JSON.parse(localStorage.getItem(k) || '[]');
  const save = (k,v) => localStorage.setItem(k, JSON.stringify(v));
  const del  = (k) => localStorage.removeItem(k);

  const fmtMZN = (v) => (Number(v)||0).toLocaleString("pt-MZ",
    { style:"currency", currency:"MZN", maximumFractionDigits:2 });

  const todayISO = () => new Date().toISOString().slice(0,10);

  const genId = (p) => {
    const d = new Date();
    return `${p}-${d.getFullYear().toString().slice(-2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${d.getHours()}${d.getMinutes()}${d.getSeconds()}${String(d.getMilliseconds()).padStart(3,'0')}`;
  };

  /** PMT com taxa nominal anual (%) e n meses */
  function pmt(principal, annualRate, nMonths){
    const i = (Number(annualRate||0)/100)/12;
    if(!principal || !nMonths || !i) return 0;
    return principal * (i / (1 - Math.pow(1+i, -nMonths)));
  }

  // --------------------------- Métricas de Crédito -------------------------
  /** Valor em dívida (total prestações - pagamentos) */
  function loanOutstanding(loan){
    const pays = load(DB.payments).filter(p=>p.loanId===loan.id);
    const paid = pays.reduce((s,p)=>s+Number(p.amount||0),0);
    const total = Number(loan.installment)*Number(loan.term);
    return Math.max(total - paid, 0);
  }

  /** Dias de atraso (DPD) simples, mensal com base no startDate */
  function loanDPD(loan){
    const start = new Date(loan.startDate);
    const term = Number(loan.term||0);
    const inst = Number(loan.installment||0);

    const pays = load(DB.payments)
      .filter(p=>p.loanId===loan.id)
      .sort((a,b)=>a.date.localeCompare(b.date));
    const paidSoFar = pays.reduce((s,p)=>s+Number(p.amount||0),0);

    const today = new Date();
    const monthsElapsed =
      Math.max(0,(today.getFullYear()-start.getFullYear())*12 + (today.getMonth()-start.getMonth()));
    const dueCount = Math.min(term, monthsElapsed+1); // inclui mês corrente
    const dueTotal = dueCount * inst;

    const unpaid = Math.max(dueTotal - paidSoFar, 0);
    if (unpaid <= 0) return 0;

    const lastDue = new Date(start);
    lastDue.setMonth(start.getMonth() + dueCount - 1);
    const diff = Math.floor((today - lastDue) / (1000*60*60*24));
    return Math.max(diff,1);
  }
  const bucket = (dpd) => dpd<=0 ? "OK" : dpd<=30 ? "1–30" : dpd<=60 ? "31–60" : "60+";

  // --------------------------- API Pública ---------------------------------
  const API = {
    DB, fmtMZN, todayISO, genId, pmt, loanOutstanding, loanDPD, bucket, version: VERSION,

    // ---- Clientes ----
    listClients(){ return load(DB.clients); },
    getClient(id){ return this.listClients().find(c=>c.id===id); },
    addClient(c){ const arr = load(DB.clients); arr.push(c); save(DB.clients, arr); return c; },
    updateClient(c){
      const arr = load(DB.clients);
      const i = arr.findIndex(x=>x.id===c.id);
      if(i>-1){ arr[i]=c; save(DB.clients,arr); }
      return c;
    },

    // ---- Processos ----
    listProcesses(){ return load(DB.processes); },
    getProcess(id){ return this.listProcesses().find(p=>p.id===id); },
    addProcess(p){ const arr = load(DB.processes); arr.push(p); save(DB.processes, arr); return p; },
    updateProcess(p){
      const arr = load(DB.processes);
      const i = arr.findIndex(x=>x.id===p.id);
      if(i>-1){ arr[i]=p; save(DB.processes,arr); }
      return p;
    },

    // ---- Loans ----
    listLoans(){ return load(DB.loans); },
    listLoansByClient(clientId){ return this.listLoans().filter(l=>l.clientId===clientId); },
    getLoan(id){ return this.listLoans().find(l=>l.id===id); },
    addLoan(l){ const arr=load(DB.loans); arr.push(l); save(DB.loans,arr); return l; },
    updateLoan(l){
      const arr = load(DB.loans); const i = arr.findIndex(x=>x.id===l.id);
      if(i>-1){ arr[i]=l; save(DB.loans,arr); }
      return l;
    },

    // ---- Pagamentos ----
    listPayments(loanId){
      return load(DB.payments)
        .filter(p=>p.loanId===loanId)
        .sort((a,b)=>b.date.localeCompare(a.date));
    },
    addPayment(p){ const arr=load(DB.payments); arr.push(p); save(DB.payments,arr); return p; },

    // ---- Utilidades admin ----
    nuke(){
      del(DB.clients); del(DB.processes); del(DB.loans); del(DB.payments);
      localStorage.setItem(VERSION_KEY, String(VERSION));
    },

    /* ================== seedDemo (volumoso, opcional) ================== */
    seedDemo(nClients=60, nProcesses=120, reset=false){
      if(reset){ this.nuke(); }

      // helpers
      const rand  = (a,b)=> Math.floor(Math.random()*(b-a+1))+a;
      const pick  = (arr)=> arr[rand(0,arr.length-1)];
      const peso  = (pairs)=> { const x=Math.random(); let acc=0; for(const [label,p] of pairs){ acc+=p; if(x<=acc) return label; } return pairs[pairs.length-1][0]; };

      const nomes = [
        "Ana João","Carlos Mucavele","Ermelinda Cossa","Gerson Tamele","Ivandro Machava","Joana Nhacale",
        "Leonor Mboa","Mariano Uamusse","Neusa Uate","Óscar Muchanga","Paula Langa","Quitéria Mambo",
        "Rui Nhachungue","Salimo Amoate","Tânia Bucuane","Vasco Jone","Zuleica Mutemba","Abel Matavele",
        "Belmina Ussene","Celso Mucave","Dercia Uamusse","Edna Sitoe","Felizardo Chongo","Gilda Mabote",
        "Helder Nhantumbo","Isabel Cumbane","Júlio Nhacale","Kátia Cumbe","Lourenço Mussá","Melina Cossa",
        "Nélson Mboa","Olga Nhacale","Paulo Jone","Quitério Mabjaia","Rita Cumbe","Sérgio Muthemba",
        "Taurai Matola","Ussene Amade","Vânia Sitoe","Walter Macuacua"
      ];
      const cidades    = ["Maputo","Matola","Beira","Nampula","Tete","Quelimane","Chimoio","Xai-Xai","Inhambane","Pemba"];
      const provincias = ["Maputo","Maputo Prov.","Sofala","Nampula","Tete","Zambézia","Manica","Gaza","Inhambane","Cabo Delgado"];
      const empreg     = ["Petromoc","CMG","EDM","Vodacom","Movitel","CDM","CFM","UTREL","Autónomo","Setor Público"];
      const bancos     = ["Millennium BIM","BCI","Standard Bank","Absa","FCB","NBC"];
      const departamentos = ["Financeiro","Operações","RH","TI","Comercial","Logística","Jurídico","Manutenção","Atendimento"];

      const tel = ()=> {
        const p = Math.random()<0.5 ? "84" : ["82","83","85","86","87"][rand(0,4)];
        return `+258 ${p} ${rand(100,999)} ${String(rand(0,999)).padStart(3,"0")}`;
      };

      const makeClient = ()=>{
        const nome = pick(nomes);
        return {
          id: this.genId("CLI"),
          nome,
          telefone: tel(),
          email: nome.toLowerCase().replace(/[^\w]+/g,".") + "@mail.mz",
          cidade: pick(cidades),
          provincia: pick(provincias),
          createdAt: Date.now() - rand(10,240)*24*3600*1000
        };
      };

      const makeKYC = (c)=>({
        estadoCivil: pick(["Solteiro(a)","Casado(a)","União de facto","Divorciado(a)"]),
        doc:{tipo:"BI", numero:String(rand(1000000,9999999)), validade:`${rand(2027,2032)}-${String(rand(1,12)).padStart(2,"0")}-15`},
        nascimento:`${rand(1978,2002)}-${String(rand(1,12)).padStart(2,"0")}-${String(rand(1,28)).padStart(2,"0")}`,
        genero: pick(["Masculino","Feminino","Outro"]),
        endereco:{morada:`Rua ${rand(1,600)}`, bairro:"Central", cidade:c.cidade, provincia:c.provincia},
        emprego:{
          empregador: pick(empreg), nuit: String(rand(100000000,999999999)),
          organica: pick(departamentos), funcao: pick(["Técnico","Analista","Supervisor","Operador","Assistente"]),
          endereco:`Av. ${rand(1,50)} nr ${rand(1,999)}`,
          supervisores:[{nome:pick(nomes), tel:tel()},{nome:pick(nomes), tel:tel()}],
          rendimento: rand(12,120)*1000, despesas: rand(0,40)*1000
        },
        pagamentos:{ banco: pick(bancos), nib: `000${rand(1000000000000,9999999999999)}`, carteira: tel() },
        referencias:[
          {nome: pick(nomes), tel: tel(), rel: pick(["Irmão","Colega","Chefe","Amigo"])},
          {nome: pick(nomes), tel: tel(), rel: pick(["Prima","Colega","Cunhado","Vizinho"])}
        ],
        pep:{ status: pick(["nao","nao","nao","sim"]), cargo:"", entidade:"" }
      });

      const stateWeighted = ()=> peso([
        ["EM VALIDAÇÃO (KYC)", 0.14],
        ["PENDENTE DOCUMENTOS", 0.06],
        ["REPROVADO (KYC)",     0.04],
        ["EM ANÁLISE BANCO",    0.12],
        ["ATIVO",               0.38],
        ["EM ATRASO",           0.16],
        ["LIQUIDADO",           0.06],
        ["NÃO ELEGÍVEL (fora política)", 0.04],
      ]);

      const addPay = (loanId, date, amount, channel="Simulado")=>{
        const arr = load(DB.payments);
        arr.push({ id:this.genId("PAY"), loanId, date:new Date(date).toISOString().slice(0,10), amount:Math.round(amount), channel });
        save(DB.payments, arr);
      };

      const createProcAndMaybeLoan = (client)=>{
        const state = stateWeighted();
        const montante = Math.floor((Math.random()*111)+10)*1000; // 10k–120k
        const prazo    = [6,9,12,18,24][rand(0,4)];
        const taxaAA   = [18,22,24,28,30][rand(0,4)];
        const prest    = this.pmt(montante, taxaAA, prazo);
        const createdAt= Date.now() - rand(0,270)*24*3600*1000;

        const proc = {
          id: this.genId("PRC"),
          clientId: client.id,
          createdAt,
          updatedAt: createdAt + rand(0,20)*86400000,
          state,
          proposta:{ montante, prazoMeses:prazo, taxaAnual:taxaAA, prestacao:prest },
          kyc: makeKYC(client),
          consultor:{ nome: client.nome.split(' ')[0]+' Consultor', contacto: tel(), banco: "Millennium BIM", nib:`000${Math.floor(Math.random()*1e13)}`, wallet: tel() },
          attachments:{ biFrente:null, biVerso:null, residencia:null, rendimentos:null }
        };

        if (["ATIVO","EM ATRASO","LIQUIDADO"].includes(state)){
          const start = new Date(createdAt - rand(0,30)*86400000); start.setDate(5);
          const loan = {
            id: "L-" + proc.id.split('-').slice(1).join(''),
            clientId: client.id,
            processId: proc.id,
            startDate: start.toISOString().slice(0,10),
            term: prazo,
            installment: Math.round(prest),
            rate: taxaAA
          };
          const loans = this.listLoans(); loans.push(loan); save(DB.loans, loans);

          const paid = state==="LIQUIDADO" ? prazo
                   : state==="EM ATRASO" ? Math.max(0, rand(0, prazo-2))
                   : rand(0, Math.max(0, prazo-1));

          for(let i=0;i<paid;i++){
            const d = new Date(start); d.setMonth(d.getMonth()+i+1);
            addPay(loan.id, d, prest, ["Depósito","Transferência","M-Pesa"][rand(0,2)]);
          }

          if(state!=="LIQUIDADO"){
            const dpd = loanDPD(loan);
            if (dpd>0) proc.state = "EM ATRASO";
          }
        }

        if (state==="PENDENTE DOCUMENTOS"){
          proc.kyc.pendencias = ["BI ilegível – reenviar frente/verso","Comprovativo de residência desatualizado","Anexar extratos dos últimos 3 meses"][rand(0,2)];
        }
        return proc;
      };

      // clientes
      let clients = this.listClients();
      while (clients.length < nClients) clients.push( makeClient() );
      save(DB.clients, clients);

      // distribuir até 3 processos por cliente
      const processes = this.listProcesses().slice();
      const maxPerClient = 3;
      const quota = new Map(clients.map(c=>[c.id, 0]));
      let i = 0;
      while (processes.length < nProcesses){
        const c = clients[i % clients.length];
        if (quota.get(c.id) < maxPerClient){
          processes.push( createProcAndMaybeLoan(c) );
          quota.set(c.id, quota.get(c.id)+1);
        }
        i++;
      }
      save(DB.processes, processes);

      return {
        clients: this.listClients().length,
        processes: this.listProcesses().length,
        loans: this.listLoans().length,
        payments: load(DB.payments).length
      };
    },
  };

  // exportar API
  window.DBApi = API;

  /* ===================== DEMO BASELINE (leve, determinístico) ===================== */
  (function baselineInstall(DBApi){
    if(!DBApi) return;
    const BASELINE_VERSION_KEY = 'cacos_demo_baseline_v1';
    const MIN = { clients: 5, processes: 10, loans: 6 };

    const fmtISO = d => d.toISOString().slice(0,10);
    const daysAgo = n => { const d=new Date(); d.setDate(d.getDate()-n); return d; };
    const monthsAgo = n => { const d=new Date(); d.setMonth(d.getMonth()-n); return d; };
    const addMonths = (d, n)=>{ const x=new Date(d); x.setMonth(x.getMonth()+n); return x; };

    const CLIENTES = [
      { id:'CLI-DEMO-001', nome:'Ermelinda Cossa',  tel:'+258 84 101 0101', cidade:'Maputo',  provincia:'Maputo Cidade' },
      { id:'CLI-DEMO-002', nome:'Paula Langa',      tel:'+258 85 202 0202', cidade:'Matola',  provincia:'Maputo Prov.' },
      { id:'CLI-DEMO-003', nome:'Vasco Jone',       tel:'+258 86 303 0303', cidade:'Beira',   provincia:'Sofala' },
      { id:'CLI-DEMO-004', nome:'Rui Nhachungue',   tel:'+258 87 404 0404', cidade:'Nampula', provincia:'Nampula' },
      { id:'CLI-DEMO-005', nome:'Ana João',         tel:'+258 82 505 0505', cidade:'Chimoio', provincia:'Manica' },
    ];

    function mkProp(montante, prazo, taxa, entrada=0){
      const principal = Math.max(montante - entrada, 0);
      const prest = Math.round(DBApi.pmt(principal, taxa, prazo));
      return { montante, prazoMeses:prazo, taxaAnual:taxa, entrada, principal, prestacao:prest };
    }
    function mkProc(id, clientId, state, createdDaysAgo, prop, extra={}){
      const createdAt = daysAgo(createdDaysAgo).getTime();
      return Object.assign({
        id, clientId, state, createdAt, updatedAt: createdAt,
        proposta: prop,
        kyc:{
          doc:{tipo:'BI', numero:'1234567', validade:'2029-12-31'},
          endereco:{morada:'Rua 1', bairro:'Central', cidade:'—', provincia:'—'},
          emprego:{empregador:'EDM', nuit:'100000000', organica:'Comercial', funcao:'Técnico', rendimento:45000, despesas:10000},
          pagamentos:{ banco:'Millennium BIM', nib:'000123...', carteira:'+258 8X XXX XXX' },
          pep:{status:'nao'}
        },
        attachments:{}, consultor:{nome:'Consultor Demo', contacto:'+258 84 999 9999'},
        payments:[]
      }, extra);
    }
    function mkLoan(id, clientId, processId, startDateISO, prazo, taxa, prest, paidCount=0){
      const loan = { id, clientId, processId, startDate: startDateISO, term:prazo, rate:taxa, installment:prest };
      const pays = [];
      for(let i=0;i<paidCount;i++){
        const dt = fmtISO(addMonths(new Date(startDateISO), i+1));
        pays.push({ id:`PG-${id}-${String(i+1).padStart(2,'0')}`, loanId:id, date:dt, amount:prest, channel:'M-Pesa' });
      }
      return { loan, pays };
    }

    function ensureBaseline(){
      const cs = DBApi.listClients();
      const ps = DBApi.listProcesses();
      const ls = DBApi.listLoans();

      const hasBaseline = !!localStorage.getItem(BASELINE_VERSION_KEY);
      if (hasBaseline && cs.length>=MIN.clients && ps.length>=MIN.processes && ls.length>=MIN.loans) return;

      // 1) Clientes fixos
      const existing = new Set(cs.map(c=>c.id));
      CLIENTES.forEach((c, i)=>{
        if(!existing.has(c.id)){
          DBApi.addClient({
            id:c.id, nome:c.nome, telefone:c.tel, cidade:c.cidade, provincia:c.provincia,
            createdAt: monthsAgo(6-i).getTime()
          });
        }
      });

      // 2) Processos + loans determinísticos (~10)
      const plan = [
        ['PRC-DEMO-001','CLI-DEMO-001','ATIVO',            210, mkProp(95000,24,24), {startMonthsAgo:7,  paid:6}],
        ['PRC-DEMO-002','CLI-DEMO-002','LIQUIDADO',        420, mkProp(60000,12,22), {startMonthsAgo:14, paid:12}],
        ['PRC-DEMO-003','CLI-DEMO-003','EM ATRASO',        90,  mkProp(82000,18,28), {startMonthsAgo:8,  paid:5}],
        ['PRC-DEMO-004','CLI-DEMO-004','EM ANÁLISE BANCO', 10,  mkProp(50000,12,22), null],
        ['PRC-DEMO-005','CLI-DEMO-005','EM VALIDAÇÃO (KYC)',5, mkProp(30000,9,24),  null],
        ['PRC-DEMO-006','CLI-DEMO-001','ATIVO',            150, mkProp(40000,12,22), {startMonthsAgo:5,  paid:4}],
        ['PRC-DEMO-007','CLI-DEMO-002','EM ATRASO',        70,  mkProp(110000,24,26),{startMonthsAgo:10, paid:7}],
        ['PRC-DEMO-008','CLI-DEMO-003','NÃO ELEGÍVEL (fora política)', 2, mkProp(20000,6,24), null],
        ['PRC-DEMO-009','CLI-DEMO-004','ATIVO',            60,  mkProp(75000,18,24), {startMonthsAgo:6,  paid:5}],
        ['PRC-DEMO-010','CLI-DEMO-005','EM VALIDAÇÃO (KYC)',1, mkProp(50000,12,22), null],
      ];

      const existingProcIds = new Set(DBApi.listProcesses().map(p=>p.id));
      const existingLoanIds = new Set(DBApi.listLoans().map(l=>l.id));

      for(const [pid, cid, state, daysBack, prop, loanCfg] of plan){
        if(!existingProcIds.has(pid)){
          const proc = mkProc(pid, cid, state, daysBack, prop);
          DBApi.addProcess(proc);
        }
        if (loanCfg){
          const start = fmtISO(monthsAgo(loanCfg.startMonthsAgo||0));
          const lid = `L-${pid.replace('PRC-','')}`;
          if(!existingLoanIds.has(lid)){
            const { loan, pays } = mkLoan(lid, cid, pid, start, prop.prazoMeses, prop.taxaAnual, prop.prestacao, loanCfg.paid||0);
            DBApi.addLoan(loan);
            pays.forEach(DBApi.addPayment);
          }
        }
      }

      localStorage.setItem(BASELINE_VERSION_KEY, '1');
    }

    // API admin
    DBApi.installDemoBaseline = function(){ ensureBaseline(); return {
      clients: DBApi.listClients().length,
      processes: DBApi.listProcesses().length,
      loans: DBApi.listLoans().length
    }; };
    DBApi.resetDemoBaseline = function(){
      DBApi.nuke();
      localStorage.removeItem(BASELINE_VERSION_KEY);
      ensureBaseline();
      return DBApi.installDemoBaseline();
    };

    // Auto-aplicar baseline se vazio/abaixo do mínimo
    try { ensureBaseline(); } catch(e){ console.warn('Baseline demo falhou:', e); }
  })(window.DBApi);

  // Marcar versão do schema (útil para invalidação simples)
  if (Number(localStorage.getItem(VERSION_KEY)||0) !== VERSION){
    localStorage.setItem(VERSION_KEY, String(VERSION));
  }
})();
