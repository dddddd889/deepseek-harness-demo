#!/usr/bin/env python3
"""验证独立 Host 二进制启动与编译后的 MCP/LSP 子角色。"""
import json
import os
from pathlib import Path
import select
import subprocess
import time
import urllib.parse
import urllib.request


def check(workspace):
    """通过真实 HTTP 驱动编译成品；审批走公开接口。"""
    directory = workspace / '.harness-binary-proof'
    environment = dict(os.environ, MODEL_BACKEND='fake', HARNESS_COMPILED='1', HARNESS_WORKSPACE=str(workspace),
                       HARNESS_DATA=str(directory), HARNESS_WEB=str(workspace / 'web'), PORT='0')
    binary = workspace / 'desktop/host/harness-host'
    process = subprocess.Popen([str(binary)], cwd=workspace, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        if not select.select([process.stdout], [], [], 15)[0]:
            raise RuntimeError('编译 Host 未就绪')
        line = process.stdout.readline()
        ready = json.loads(line)
        url = urllib.parse.urlparse(ready['url'])
        base = f'{url.scheme}://{url.netloc}'
        token = urllib.parse.parse_qs(url.query)['token'][0]

        def request(path, data=None):
            """对本次随机端口提交经过令牌授权的请求。"""
            body = None if data is None else json.dumps(data).encode()
            req = urllib.request.Request(base + path, data=body,
                    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.load(response)

        identity = request('/api/sessions', {})['id']
        path = '/api/sessions/' + identity
        for label, prompt in [('mcp', '/tool mcp_project_info {}'), ('lsp', '/tool diagnostics {"path":"syntax-proof.ts"}')]:
            (workspace / 'syntax-proof.ts').write_text('const x = ;')
            turn = request(path + '/prompts', {'prompt': prompt, 'requestId': 'binary-' + label})['turnId']
            answered = set()
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                events = [event for event in request(path)['events'] if event['turnId'] == turn]
                for event in events:
                    if event['type'] == 'approval' and event['data']['id'] not in answered:
                        request(path + '/approvals', {'id': event['data']['id'], 'allow': True})
                        answered.add(event['data']['id'])
                done = next((event for event in events if event['type'] == 'done'), None)
                if done:
                    results = [event['data'] for event in events if event['type'] == 'tool_end']
                    if done['data']['reason'] != 'stop' or not results or results[0]['failed']:
                        raise RuntimeError(json.dumps(events, ensure_ascii=False))
                    if label == 'lsp' and not json.loads(results[0]['result'])['items']:
                        raise RuntimeError('编译 LSP 没返回坏语法诊断')
                    print('编译成品 ' + label.upper() + '：真实子角色与工具结果通过', flush=True)
                    break
                time.sleep(0.03)
            else:
                raise RuntimeError('编译工具验收超时：' + label)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    if (directory / 'host.lock').exists():
        raise RuntimeError('编译 Host 退出后遗留锁')
    print('编译成品：Host 退出释放锁通过', flush=True)


if __name__ == '__main__':
    import sys
    check(Path(sys.argv[1]).resolve())
