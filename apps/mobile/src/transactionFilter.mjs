const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().trim();

// Amounts are searched in yuan, never as raw integer cents.
export function matchesTransaction(transaction,query){
  const text=normalize(query);
  if(!text)return true;
  const yuan=transaction.amount_minor/100;
  const haystack=normalize([transaction.category_name,transaction.ledger_name,transaction.remark,transaction.occurred_on,String(yuan),yuan.toFixed(2)].join(' '));
  const numeric=text.replace(/[,，¥￥元\s]/g,'');
  if(/^[+-]?\d+(?:\.\d+)?$/.test(numeric)){
    return haystack.includes(text)||[String(yuan),yuan.toFixed(2)].some(value=>value.includes(numeric));
  }
  return text.split(/\s+/).every(term=>haystack.includes(term));
}

export function filterTransactions(transactions,{ledger='',category='',income=false,query=''}={}){
  return transactions.filter(t=>(!ledger||t.ledger_id===ledger)&&(!category||t.category_id===category)&&(!income||t.direction==='income')&&matchesTransaction(t,query))
    .sort((a,b)=>a.occurred_on.localeCompare(b.occurred_on)||String(a.id).localeCompare(String(b.id)));
}
