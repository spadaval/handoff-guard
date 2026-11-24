#!/usr/bin/env python3
"""Exercise the installed Codex binary against a loopback scripted Responses server.
No remote model, credentials, or active Codex configuration is used or modified.
"""
import argparse
import http.server
import hashlib
import shlex
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]


def run_case(binary, scenario='normal'):
    (ROOT / 'data/private').mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='handoff-hook-') as temp:
        home = Path(temp)
        audit = home / 'hook-events.jsonl'
        wrapper = home / 'audit-hook.py'
        wrapper.write_text('import json,sys,subprocess\nfrom pathlib import Path\ns=sys.stdin.read()\nwith Path(' + repr(str(audit)) + ').open("a") as f: f.write(s+"\\n")\nr=subprocess.run([' + repr(str(binary)) + '],input=s,text=True,capture_output=True)\nprint(r.stdout)\nsys.exit(r.returncode)\n')
        commands = []
        for tool in ['spawn_agent', 'send_message', 'followup_task']:
            message = "'Please return OK.'" if scenario in ['normal', 'startup-error', 'timeout', 'exit-one'] else "['word'].join(' ').repeat(13001)"
            arg = f"{{task_name:'fixture',message:{message}}}" if tool == 'spawn_agent' else f"{{message:{message}}}"
            if tool != 'spawn_agent': arg = f"{{target:'fixture',{arg[1:]}"
            commands.append(f"try {{ text(await tools.collaboration__{tool}({arg})); }} catch(e) {{ text(String(e)); }}")
        if scenario == 'denied':
            # Spawn a real fresh child after the denied spawn, then target that
            # child with the two denied deliveries.
            commands.insert(1, "text(await tools.collaboration__spawn_agent({task_name:'fixture',message:'Please return OK.'}));")
        code = '\n'.join(commands)
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                import gzip
                body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                if self.headers.get('Content-Encoding') == 'gzip': body = gzip.decompress(body)
                data = json.loads(body); requests.append(data)
                # Only the root's first response contains calls. Child turns return OK.
                if len(requests) == 1:
                    item = {'type':'custom_tool_call','id':'call_item','call_id':'call_guard','name':'exec','namespace':'functions','input':code,'status':'completed'}
                else:
                    item = {'type':'message','id':'msg_ok','role':'assistant','content':[{'type':'output_text','text':'OK','annotations':[]}],'status':'completed'}
                events = [ {'type':'response.created','response':{'id':f'resp_{len(requests)}','object':'response','status':'in_progress','output':[]}},
                           {'type':'response.output_item.added','output_index':0,'item':item},
                           {'type':'response.output_item.done','output_index':0,'item':item},
                           {'type':'response.completed','response':{'id':f'resp_{len(requests)}','object':'response','status':'completed','output':[item], 'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}} ]
                payload = ''.join('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n' for e in events).encode()
                self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
        server = http.server.ThreadingHTTPServer(('127.0.0.1',0), Handler)
        thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        config = f'''model = "gpt-6.1-sol"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture]
name = "Local integration fixture"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
code_mode = true
code_mode_only = true
multi_agent_v2 = {{ enabled = true, non_code_mode_only = false }}
hooks = true
'''
        (home / 'config.toml').write_text(config)
        if scenario == 'timeout':
            wrapper.write_text('import time\ntime.sleep(3)\n')
        elif scenario == 'exit-one':
            wrapper.write_text('import sys\nsys.exit(1)\n')
        hook_config = json.loads((ROOT / 'examples/hooks.json').read_text())
        handler = hook_config['hooks']['PreToolUse'][0]['hooks'][0]
        handler['command'] = '/does-not-exist-handoff-hook' if scenario == 'startup-error' else f'python3 {shlex.quote(str(wrapper))}'
        handler['timeout'] = 1
        (home / 'hooks.json').write_text(json.dumps(hook_config))
        env = {**os.environ, 'CODEX_HOME':str(home)}
        try:
            result = subprocess.run(['codex','exec','--json','--skip-git-repo-check','--dangerously-bypass-hook-trust','-C',str(home),'Run the local scripted hook integration fixture.'],env=env,stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=45)
        finally:
            server.shutdown(); thread.join()
        events = [json.loads(line) for line in audit.read_text().splitlines()] if audit.exists() else []
        target = [e for e in events if any(e['tool_name'].endswith(t) for t in ['spawn_agent','send_message','followup_task'])]
        summary = {'scenario':scenario,'codex_exit':result.returncode,'requests':len(requests),'intercepted':[{'tool':e['tool_name'],'characters':len(e['tool_input'].get('message',''))} for e in target], 'stdout':result.stdout,'stderr':result.stderr}
        # Keep integration traces local; no corpus text is involved.
        dest = ROOT / 'data/private' / f'integration-{scenario}.json'
        dest.write_text(json.dumps({'summary':summary,'events':events,'requests':requests},indent=2)); dest.chmod(0o600)
        outputs = [x for req in requests for x in req.get('input', []) if x['type'].endswith('call_output')]
        output_text = json.dumps(outputs)
        assert result.returncode == 0, summary
        if scenario == 'denied':
            assert len(target) == 4, summary
            for tool in ['spawn_agent', 'send_message', 'followup_task']:
                assert f'Tool: collaboration{tool}' in result.stderr, summary
            assert output_text.count('Tool call blocked by PreToolUse hook:') >= 3, summary
            # A forbidden payload must never reach a child model request.
            for req in requests:
                delivered = [x for x in req.get('input', []) if x['type'] == 'agent_message']
                assert 'wordwordwordwordword' not in json.dumps(delivered)
            assert any('/root/fixture' in x.get('text','') for o in outputs if isinstance(o.get('output'),list) for x in o['output']), summary
        else:
            assert 'Tool call blocked by PreToolUse hook:' not in output_text, summary
            assert '/root/fixture' in output_text, summary
            delivered = json.dumps([x for req in requests for x in req.get('input',[]) if x['type'] == 'agent_message'])
            assert 'Message Type: MESSAGE' in delivered and 'Message Type: NEW_TASK' in delivered, summary
            assert 'TypeError' not in output_text and 'not found' not in output_text, summary
        concise = {k:v for k,v in summary.items() if k not in ['stdout','stderr']}
        concise['assertions_passed'] = True
        concise['binary_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        (ROOT/'data/private'/f'integration-{scenario}-summary.json').write_text(json.dumps(concise,indent=2)+'\n')
        print(json.dumps(concise,indent=2))
        return summary

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,default=ROOT/'target/release/handoff-guard')
    parser.add_argument('--scenario',choices=['normal','denied','startup-error','timeout','exit-one'],default='denied')
    args=parser.parse_args(); run_case(args.binary,args.scenario)
