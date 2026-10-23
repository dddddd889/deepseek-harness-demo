"""与自己实现的Node SDK服务共用NDJSON协议，不启动另一套Agent。"""
import json
import os
import queue
import subprocess
import threading
import uuid


class HarnessSDK:
    """独立读取线程派发响应/通知，关闭时拒绝仍在等待的请求。"""
    def __init__(self, node, server, home, cwd):
        self.process = subprocess.Popen([node, server], cwd=cwd, env=dict(os.environ, HARNESS_HOME=home), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
        self.pending = {}
        self.events = []
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        """只做线消息分派；通知不被误认为当前request的返回值。"""
        try:
            for line in self.process.stdout:
                message = json.loads(line)
                with self.lock:
                    if 'id' in message and message['id'] in self.pending:
                        self.pending[message['id']].put(message)
                    elif message.get('method') == 'session.event':
                        self.events.append(message['params'])
        finally:
            with self.lock:
                for waiting in self.pending.values():
                    waiting.put({'error': {'message': 'SDK连接断开'}})

    def request(self, method, params, timeout=30):
        """写入和pending登记在同一把锁内，避免快速响应先于登记。"""
        identity = str(uuid.uuid4())
        waiting = queue.Queue()
        with self.lock:
            self.pending[identity] = waiting
            self.process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': identity, 'method': method, 'params': params}, ensure_ascii=False) + '\n')
            self.process.stdin.flush()
        try:
            message = waiting.get(timeout=timeout)
            if 'error' in message:
                raise RuntimeError(message['error']['message'])
            return message['result']
        finally:
            with self.lock:
                self.pending.pop(identity, None)

    def run(self, cwd, text):
        """明确接收、订阅、等待与读取事实四个动作。"""
        session = self.request('session.create', {'cwd': cwd})
        identity = session['id']
        self.request('session.watch', {'id': identity})
        self.request('session.submit', {'id': identity, 'content': text})
        ending = self.request('session.wait', {'id': identity})
        return {'ending': ending, 'events': self.request('session.read', {'id': identity})}

    def close(self):
        """先发EOF等正常清理，超时再终止并回收。"""
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.thread.join(timeout=1)

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.close()
