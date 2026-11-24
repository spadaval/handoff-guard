<script lang="ts">
 let {role}:{role:string}=$props();
 const roles:Record<string,{name:string;ink:string;edge:string;bg:string;path:string}>={
  coordinator:{name:'Coordinator',ink:'#91d4cf',edge:'#487b7a',bg:'#192d32',path:'M12 4v5m0 0H5v6m7-6h7v6M9 2h6v4H9zM2 16h6v5H2zm14 0h6v5h-6z'},
  implementer:{name:'Implementer',ink:'#aecbff',edge:'#536e99',bg:'#202c40',path:'M14 5a5 5 0 0 0-6 6L3 17l4 4 6-6a5 5 0 0 0 6-6l-4 2-2-2 2-4z'},
  reviewer:{name:'Reviewer',ink:'#d2b8f1',edge:'#7e639b',bg:'#30273c',path:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0'},
  validator:{name:'Validator',ink:'#aedcb1',edge:'#5b825e',bg:'#24332a',path:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4zM7 12l3 3 7-7'},
  researcher:{name:'Researcher',ink:'#e8c88d',edge:'#8a744d',bg:'#352f24',path:'M15 9a6 6 0 1 0-12 0 6 6 0 0 0 12 0zm-1 5 7 7M6 7h6M6 10h4'},
  worker:{name:'Worker',ink:'#edb9a0',edge:'#966d56',bg:'#362a25',path:'M3 7h18v14H3zM8 7V3h8v4M3 12h18M10 11v4h4v-4'},
  user:{name:'User',ink:'#e9bbd1',edge:'#946c80',bg:'#362833',path:'M16 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0M4 22v-3a8 8 0 0 1 16 0v3'},
  unknown:{name:'Unknown',ink:'#bdc8d2',edge:'#5b6e7e',bg:'#25313b',path:'M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0M9 8a3 3 0 1 1 4 3c-1 1-1 1-1 3m0 3v1'}
 };
 let node=$derived(roles[role]??roles.unknown);
</script>
<div class="agent-node" style:--role-ink={node.ink} style:--role-edge={node.edge} style:--role-bg={node.bg}>
 <svg viewBox="0 0 24 24" aria-hidden="true"><path d={node.path}/></svg><span>{node.name}</span>
</div>
