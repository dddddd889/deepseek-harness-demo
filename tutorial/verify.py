#!/usr/bin/env python3
"""在临时空目录按顺序叠加教程文件，验证每步累计代码。"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from check_binary import check


def run(command, workspace, environment):
    """运行实际命令；失败时保留完整输出供定位。"""
    result = subprocess.run(command, cwd=workspace, env=environment, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(' '.join(command) + '\n' + result.stdout + result.stderr)
    return result.stdout + result.stderr


def main():
    """维护者使用固定依赖运行验证，不修改学习者目录。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--deps', required=True, help='已安装教程依赖的 node_modules 绝对路径')
    arguments = parser.parse_args()
    dependencies = Path(arguments.deps).resolve()
    if not dependencies.is_dir():
        raise ValueError('依赖目录不存在')
    steps = Path(__file__).resolve().parent / 'steps'
    with tempfile.TemporaryDirectory(prefix='harness-linear-', dir='/private/tmp') as temporary:
        workspace = Path(temporary)
        (workspace / 'node_modules').symlink_to(dependencies, target_is_directory=True)
        environment = dict(os.environ, MODEL_BACKEND='fake', HARNESS_WORKSPACE=str(workspace), HARNESS_DATA=str(workspace / '.harness'))
        for step in sorted(steps.iterdir()):
            shutil.copytree(step, workspace, dirs_exist_ok=True)
            output = run(['bun', 'test'], workspace, environment)
            print('步骤 ' + step.name + '：累计测试通过', flush=True)
            if step.name == '16':
                for label, prompt, extra in [
                    ('read', '/tool read {"path":"package.json"}', {}),
                    ('cancel', '/slow', {'ACP_CANCEL': 'yes'}),
                    ('approve', '/tool write {"path":"acp-proof.txt","content":"ok"}', {'ACP_ALLOW': 'yes'}),
                ]:
                    acp_env = dict(environment, HARNESS_DATA=str(workspace / ('.harness-acp-' + label)), **extra)
                    result = run(['bun', 'scripts/acp-client.ts', prompt], workspace, acp_env)
                    expected = 'cancelled' if label == 'cancel' else 'end_turn'
                    if 'stopReason=' + expected not in result:
                        raise RuntimeError(result)
                print('ACP：读文件、取消、反向审批三个进程间场景通过', flush=True)
            if step.name == '23':
                run([str(dependencies / '.bin/tsc'), '--noEmit'], workspace, environment)
                run(['bun', 'scripts/package.ts'], workspace, environment)
                print('严格类型检查与自带运行时 Host 编译通过', flush=True)
                check(workspace)
        print(output.strip().splitlines()[-3:], flush=True)


if __name__ == '__main__':
    main()
