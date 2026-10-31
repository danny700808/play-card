/* Display filters only. Unknown legacy identities stay visible in their own filter. */
(function(root){
  const identityOf=row=>{
    const form=row.formData||row.data||{};
    const value=String(row.identityType||form.identityType||row.identityLabel||form.identityLabel||form.teacherIdentity||'').toLowerCase();
    if(value==='external'||value.includes('外聘'))return 'external';
    if(value==='parttime'||value.includes('工讀'))return 'parttime';
    if(['staff','fulltime','full-time'].includes(value)||/專職|正職/.test(value))return 'staff';
    return 'unknown';
  };
  const matches=(row,identity,type)=>(!identity||identity==='all'||identityOf(row)===identity)&&(!type||type==='all'||row.certificateType===type);
  function mount(onChange,includeType){
    const node=document.getElementById('certificateScope');if(!node)return;
    const query=new URLSearchParams(location.search);
    node.innerHTML='<label>身分 <select id="certificateIdentity"><option value="all">全部人員</option><option value="staff">專職</option><option value="parttime">工讀生</option><option value="external">外聘老師</option><option value="unknown">身分待確認</option></select></label>'+(includeType?'<label>證明 <select id="certificateType"><option value="all">全部證明</option><option value="employment">在職證明</option><option value="teaching">教學證明</option></select></label>':'');
    const identity=document.getElementById('certificateIdentity');identity.value=['staff','parttime','external','unknown'].includes(query.get('identity'))?query.get('identity'):'all';
    const type=document.getElementById('certificateType');if(type)type.value=['teaching','employment'].includes(query.get('type'))?query.get('type'):'all';
    node.addEventListener('change',onChange);
  }
  function filter(rows){return rows.filter(row=>matches(row,document.getElementById('certificateIdentity')?.value,document.getElementById('certificateType')?.value));}
  const api={identityOf,matches,mount,filter};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CertificateWorkspace=api;
})(typeof window==='object'?window:this);
