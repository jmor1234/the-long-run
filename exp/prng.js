// Seeded PRNG streams for the LLM-bots experiment.
// Every draw is keyed by a string, so values never depend on execution order.

function fnv1a(str){
  let h=0x811c9dc5;
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,0x01000193);
  }
  return h>>>0;
}

function mulberry32(seed){
  let a=seed>>>0;
  return function(){
    a|=0; a=(a+0x6D2B79F5)|0;
    let t=Math.imul(a^(a>>>15), 1|a);
    t=(t+Math.imul(t^(t>>>7), 61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

// stream('seed|deal|17') -> generator function () => [0,1)
function stream(key){
  return mulberry32(fnv1a(String(key)));
}

module.exports={stream, fnv1a};
