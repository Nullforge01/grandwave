
document.addEventListener("pointerdown", e => {
  const card=e.target.closest(".gw-card,.gw-primary,.gw-secondary");
  if(card) card.style.transform="scale(.975)";
});
document.addEventListener("pointerup", e => {
  const card=e.target.closest(".gw-card,.gw-primary,.gw-secondary");
  if(card) card.style.transform="";
});
