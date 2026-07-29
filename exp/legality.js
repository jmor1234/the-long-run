// Action-legality normalizer for LLM decisions. Runs BEFORE applyAction.
//
// The engine has no legality guard: applyAction accepts `check` facing a bet
// (the round then never completes and the hand loops forever) and silently
// floors under-min raises. LLM output must be normalized here, and every
// coercion counted — raw illegality is a pre-registered experiment metric.
//
// Amount contract (matches applyAction): amount = TOTAL chips wagered this
// street after the action (bet-to level), not an increment.

const ACTIONS=new Set(['fold','check','call','bet','raise']);

// view: {toCall, currentBet, minRaise, myBet, stack}
// returns {d:{action, amount?, reason?}, clamps:[{code, detail?}], rawIllegal}
function normalize(d, view){
  const clamps=[];
  const out={};
  const push=(code,detail)=>clamps.push(detail===undefined?{code}:{code,detail});

  let action=(d && typeof d.action==='string') ? d.action.toLowerCase().trim() : null;
  if(!action || !ACTIONS.has(action)){
    push('unknown-action', action);
    action = view.toCall>0 ? 'fold' : 'check';
  }

  if(action==='check' && view.toCall>0){ push('check-facing-bet'); action='fold'; }
  if(action==='call' && view.toCall<=0){ push('call-nothing'); action='check'; }
  if(action==='fold' && view.toCall<=0){ push('fold-when-free'); action='check'; }
  if(action==='bet' && view.toCall>0){ push('bet-should-be-raise'); action='raise'; }
  if(action==='raise' && view.toCall<=0 && view.currentBet===0){ action='bet'; } // cosmetic, engine-equivalent

  if(action==='bet' || action==='raise'){
    const allIn=view.myBet+view.stack;
    if(allIn<=view.currentBet){
      // cannot even flat the current bet in full: a raise is impossible
      push('raise-impossible');
      out.action='call';
      out.d={action:'call'};
    } else {
      const minTarget=Math.min(view.currentBet+view.minRaise, allIn); // short all-in "raise" is legal
      let amt=Number(d && d.amount);
      if(!Number.isFinite(amt)){ push('missing-amount'); amt=minTarget; }
      amt=Math.round(amt);
      if(amt>allIn){ push('amount-over-stack', amt-allIn); amt=allIn; }
      if(amt<minTarget){ push('amount-under-min', minTarget-amt); amt=minTarget; }
      out.action=action; out.amount=amt;
    }
  } else {
    out.action=action;
  }

  if(d && d.reason) out.reason=d.reason;
  return {d:out, clamps, rawIllegal:clamps.length>0};
}

module.exports={normalize};
