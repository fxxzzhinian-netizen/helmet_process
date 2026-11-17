"""Configure the dedicated Ubuntu deployment after uploading and verifying the release.

Run with sudo using the deployment's Python. Passwords stay in restricted files, never in logs.
Existing application data, model files, and entry credentials are retained on repeated runs.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import grp
import secrets
import shutil
import subprocess

ROOT = Path('/opt/helmet-review')
RELEASE = ROOT / 'releases/20261115-consensus-v2'
EXPECTED = '744b026d86affdfd04cf65076d42e4d07da36024f4c9c70eef53e238af90682e'


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo.')
    weight = ROOT / 'shared/weights/v1_epoch_2.pth'
    with weight.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != EXPECTED:
            raise SystemExit('Weight checksum mismatch; deployment was not activated.')
    runtime = RELEASE / 'model/runtime/CoDETR_v1_epoch_2'
    runtime.joinpath('weights').mkdir(exist_ok=True)
    link = runtime / 'weights/v1_epoch_2.pth'
    if not link.exists():
        link.symlink_to(weight)
    current = ROOT / 'current'
    if current.exists() and current.resolve() != RELEASE:
        raise SystemExit('A different release is already active; leaving it unchanged.')
    if not current.exists():
        current.symlink_to(RELEASE, target_is_directory=True)

    ubuntu = pwd.getpwnam('ubuntu')
    env = ROOT / 'shared/service.env'
    if not env.exists():
        env.write_text('HELMET_DEVICE=cuda:0\n'
                       'HELMET_MODEL_URL=http://127.0.0.1:8766\n'
                       f'HELMET_MODEL_TOKEN={secrets.token_urlsafe(32)}\n'
                       'HELMET_DATA_DIR=/opt/helmet-review/shared/data\n'
                       'HELMET_MODEL_DIR=/opt/helmet-review/current/model/runtime/CoDETR_v1_epoch_2\n', encoding='utf-8')
        os.chown(env, ubuntu.pw_uid, ubuntu.pw_gid)
        env.chmod(0o600)

    access = ROOT / 'shared/access.json'
    if not access.exists():
        access.write_text(json.dumps({'url': 'http://129.28.125.234', 'username': 'admin',
                                      'password': secrets.token_urlsafe(18)}, indent=2), encoding='utf-8')
        os.chown(access, ubuntu.pw_uid, ubuntu.pw_gid)
        access.chmod(0o600)
    credentials = json.loads(access.read_text(encoding='utf-8'))
    hashed = subprocess.run(['openssl', 'passwd', '-apr1', '-stdin'],
                            input=credentials['password'] + '\n', text=True, capture_output=True, check=True).stdout.strip()
    password_file = Path('/etc/nginx/helmet-review.htpasswd')
    password_file.write_text(credentials['username'] + ':' + hashed + '\n', encoding='utf-8')
    os.chown(password_file, 0, grp.getgrnam('www-data').gr_gid)
    password_file.chmod(0o640)

    templates = Path(__file__).resolve().parent
    for unit in ('helmet-model.service', 'helmet-web.service'):
        shutil.copyfile(templates / unit, Path('/etc/systemd/system') / unit)
    default = Path('/etc/nginx/sites-available/default')
    backup = default.with_name('default.before-helmet')
    if default.exists() and not backup.exists():
        shutil.copy2(default, backup)
    shutil.copyfile(templates / 'nginx-site.conf', default)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'helmet-model', 'helmet-web', 'nginx'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print('DEPLOYMENT_STARTED; access details saved in /opt/helmet-review/shared/access.json')


if __name__ == '__main__':
    main()
