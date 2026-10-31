document.body.classList.add('hr-workspace');
document.querySelectorAll('.hr-workspace-nav a').forEach(function(link){
  if(new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current','page');
});
