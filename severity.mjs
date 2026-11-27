export const SEVERITIES=Object.freeze({1:'Critical',2:'Warning',3:'Advisory',4:'Informational'});
export function severityLevel(value){
  if(!Number.isInteger(value)||!SEVERITIES[value])throw Error('Severity must be an integer from 1 to 4');
  return value;
}
export function defaultSeverity(category){
  return ({price:3,reserve_updates:4,digest:4,format_preview:4,subscription_status:4})[category]??2;
}
export function severityPayload(payload,level){
  severityLevel(level);
  const result=structuredClone(payload);
  for(const embed of result.embeds??[])embed.footer={...embed.footer,text:`Sev ${level} · ${SEVERITIES[level]}${embed.footer?.text?' · '+embed.footer.text:''}`.slice(0,2048)};
  return result;
}
