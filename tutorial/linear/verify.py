#!/usr/bin/env python3
"""维护者从空目录逐步验证，拒绝使用后续文件或原版 node_modules 偷跑。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent


def main():
    """每步写入本步增量并真实运行；日志保存在明确的临时验证目录。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--bun', default=shutil.which('bun'), help='固定使用本机 Bun 1.3.14')
    parser.add_argument('--until', type=int)
    parser.add_argument('--install', action='store_true', help='在出现依赖变化时实际安装，不引用原版依赖')
    parser.add_argument('--resume', action='store_true', help='仅在已验证前缀源码hash完全一致时继续新增步骤')
    args = parser.parse_args()
    if not args.bun:
        raise ValueError('请先安装 Bun 1.3.14')
    bun = str(Path(args.bun).resolve())
    version = subprocess.check_output([bun, '--version'], text=True).strip()
    if version != '1.3.14':
        raise ValueError('验证固定需要 Bun 1.3.14')
    project = Path(tempfile.mkdtemp(prefix='harness-own-bun-', dir='/private/tmp'))
    evidence = []
    lessons = json.loads((ROOT / 'lessons.json').read_text())
    environment = dict(os.environ, BUN_CONFIG_NO_CLEAR_TERMINAL='1')
    # 维护者验收将下载缓存与临时解包都放在允许写入的临时目录。
    environment['TMPDIR'] = '/private/tmp'
    environment['BUN_INSTALL_CACHE_DIR'] = '/private/tmp/harness-bun-package-cache'
    environment.pop('DEEPSEEK_API_KEY', None)
    environment.pop('DEEPSEEK_BASE_URL', None)
    # 明确把同一 Bun 放在 PATH 首位；不读取原版依赖目录。
    environment['PATH'] = str(Path(bun).parent) + os.pathsep + environment['PATH']
    print('验证目录：' + str(project), flush=True)
    installed = {}
    implementation = {}
    verified_count = 0
    if args.resume:
        previous = json.loads((ROOT / 'verification.json').read_text())
        if previous.get('bun') != version:
            raise ValueError('Bun版本改变，不能复用前缀证据')
        if any(row['exitCode'] != 0 for row in previous['steps']):
            raise ValueError('前缀包含失败检查点，必须从空目录重新验收')
        verified_count = len(previous['steps'])
        project.rmdir()
        project = Path(previous['project'])
        for lesson in lessons[:verified_count]:
            for source in (ROOT / 'steps' / lesson['id']).rglob('*'):
                if source.is_file():
                    implementation[source.relative_to(ROOT / 'steps' / lesson['id']).as_posix()] = hashlib.sha256(source.read_bytes()).hexdigest()
        digest = hashlib.sha256(json.dumps(implementation, sort_keys=True).encode()).hexdigest()
        if digest != previous['steps'][-1]['implementationHash']:
            raise ValueError('前缀源码变化，必须从空目录重新验收')
        for name, expected in implementation.items():
            if hashlib.sha256((project / name).read_bytes()).hexdigest() != expected:
                raise ValueError('验证目录文件变化：' + name)
        evidence = previous['steps']
        package = json.loads((project / 'package.json').read_text())
        installed = {**package.get('dependencies', {}), **package.get('devDependencies', {})}
        print('前缀源码hash与实际文件一致，继续：' + str(project), flush=True)
    for lesson in lessons:
        if int(lesson['id']) < verified_count:
            continue
        if args.until is not None and int(lesson['id']) > args.until:
            break
        shutil.copytree(ROOT / 'steps' / lesson['id'], project, dirs_exist_ok=True)
        for source in (ROOT / 'steps' / lesson['id']).rglob('*'):
            if source.is_file():
                implementation[source.relative_to(ROOT / 'steps' / lesson['id']).as_posix()] = hashlib.sha256(source.read_bytes()).hexdigest()
        package = json.loads((project / 'package.json').read_text())
        dependencies = {**package.get('dependencies', {}), **package.get('devDependencies', {})}
        if dependencies != installed:
            if not args.install:
                raise RuntimeError('出现第三方依赖，需要显式 --install，不能借原版 node_modules')
            lock = ROOT / 'locks' / (lesson['id'] + '.bun.lock')
            if lock.exists():
                shutil.copyfile(lock, project / 'bun.lock')
            # 依赖安装不暗中下载 Electron；GUI 二进制在独立人工验收时显式安装。
            install_command = [bun, 'install', '--ignore-scripts'] + (['--frozen-lockfile'] if lock.exists() else [])
            installation = subprocess.run(install_command, cwd=project, env=environment, capture_output=True, text=True, timeout=300)
            (project / f'install-{lesson["id"]}.log').write_text(installation.stdout + installation.stderr)
            if installation.returncode:
                raise RuntimeError('依赖安装失败，查看 ' + str(project / f'install-{lesson["id"]}.log'))
            installed = dependencies
            lock.parent.mkdir(exist_ok=True)
            shutil.copyfile(project / 'bun.lock', lock)
        start = time.monotonic()
        # 使用 Bun 原生测试器；当前目录只包含已经叠加到本步的文件。
        command = [bun, 'test', './tests']
        result = subprocess.run(command, cwd=project, env=environment, capture_output=True, text=True, timeout=90)
        (project / f'evidence-{lesson["id"]}.log').write_text(result.stdout + result.stderr)
        digest = hashlib.sha256(json.dumps(implementation, sort_keys=True).encode()).hexdigest()
        row = {'step': lesson['id'], 'implementationHash': digest, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - start, 3), 'command': command, 'project': str(project), 'role': 'independent-tutorial-implementation'}
        evidence.append(row)
        # 每步落证据，失败后保留已真实通过的前缀，禁止凭最终一次运行冒充逐步验收。
        (ROOT / 'verification.json').write_text(json.dumps({'bun': version, 'project': str(project), 'steps': evidence}, ensure_ascii=False, indent=2) + '\n')
        print(f'{lesson["id"]} exit={result.returncode} {row["seconds"]}s', flush=True)
        if result.returncode:
            print(result.stdout + result.stderr)
            raise RuntimeError('本步不能运行；验证目录保留，不继续生成通过记录。')
    (ROOT / 'verification.json').write_text(json.dumps({'bun': version, 'project': str(project), 'steps': evidence}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
