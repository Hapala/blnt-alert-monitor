// Discord budgets apply to the whole request, not just individual fields.
export function textParts(text,limit=1900){
  const parts=[];let remaining=String(text??'');
  while(remaining.length>limit){let at=remaining.lastIndexOf('\n',limit);if(at<limit/2)at=limit;parts.push(remaining.slice(0,at));remaining=remaining.slice(at).replace(/^\n/,'');}
  if(remaining)parts.push(remaining);return parts;
}
export function discordPayloads(payload){
  const {embeds=[],content,...rest}=payload,parts=[];
  for(const text of textParts(content))parts.push({...rest,content:text,allowed_mentions:{parse:[]}});
  for(const source of embeds){
    const base={...source,title:source.title?.slice(0,256),footer:source.footer?{...source.footer,text:source.footer.text.slice(0,512)}:undefined};delete base.fields;delete base.description;
    const descriptions=textParts(source.description,3500),fields=(source.fields??[]).flatMap(f=>textParts(f.value,1000).map(value=>({...f,name:f.name.slice(0,256),value})));
    let embed={...base,description:descriptions.shift(),fields:[]};
    const size=e=>(e.title?.length??0)+(e.description?.length??0)+(e.footer?.text?.length??0)+(e.author?.name?.length??0)+e.fields.reduce((n,f)=>n+f.name.length+f.value.length,0);
    const flush=()=>{parts.push({...rest,embeds:[embed],allowed_mentions:{parse:[]}});embed={...base,fields:[]};};
    for(const description of descriptions){flush();embed.description=description;}
    for(const field of fields){if(embed.fields.length>=24||size(embed)+field.name.length+field.value.length>5500)flush();embed.fields.push(field);}
    flush();
  }
  return parts.length?parts:[{...rest,content:'No data available.',allowed_mentions:{parse:[]}}];
}
export async function privateReply(interaction,content){
  const parts=textParts(content);await interaction.editReply({content:parts.shift()??'No data available.',allowedMentions:{parse:[]}});
  for(const part of parts)await interaction.followUp({content:part,flags:64,allowedMentions:{parse:[]}});
}
