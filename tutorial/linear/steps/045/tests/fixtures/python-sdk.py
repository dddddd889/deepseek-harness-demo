"""真实Python→Node子进程的keyless场景。"""
import json
import sys
from harness_sdk import HarnessSDK

with HarnessSDK(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[3]) as sdk:
    result = sdk.run(sys.argv[3], '来自Python的任务')
    assert result['ending']['reason'] == 'completed'
    assert any(event['type'] == 'message/assistant' for event in result['events'])
    print(json.dumps({'reason': result['ending']['reason']}, ensure_ascii=False))
