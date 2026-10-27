"""Install the optional owner-only Tailscale hop from an existing private config."""
import argparse,ipaddress,json,pathlib,subprocess,os,pwd,sqlite3,time,uuid
parser=argparse.ArgumentParser();parser.add_argument('--root',default='/home/jetson/donson-access');args=parser.parse_args()
ROOT=pathlib.Path(args.root).resolve()
assert os.geteuid()==0, 'Run the installer as root'
settings=json.loads((ROOT/'private-data/jetson-chain.json').read_text())
gateway=settings['gateway'];address=gateway['server'];port=gateway['port']
assert ipaddress.ip_address(address) in ipaddress.ip_network('100.64.0.0/10') and isinstance(port,int) and 1024<=port<=65535
uuid.UUID(gateway['uuid']);uuid.UUID(settings['ownerUserId'])
with sqlite3.connect((ROOT/'private-data/portal.sqlite').as_uri()+'?mode=ro',uri=True) as db:
 owner=db.execute('SELECT role,enabled,must_change,expires_at FROM users WHERE id=?',(settings['ownerUserId'],)).fetchone()
assert owner and owner[0]=='user' and owner[1] and not owner[2] and (not owner[3] or owner[3]>time.time()*1000), 'Ready owner required'
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True)
directory=pathlib.Path('/etc/kenxu-chain');library=pathlib.Path('/usr/local/lib/kenxu-chain')
if not directory.exists():directory.mkdir(mode=0o750)
try:account=pwd.getpwnam('kenxu-chain')
except KeyError:
 run('useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','kenxu-chain');account=pwd.getpwnam('kenxu-chain')
os.chown(directory,0,account.pw_gid);os.chmod(directory,0o750);library.mkdir(exist_ok=True,mode=0o755)
blocked=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','224.0.0.0/4','240.0.0.0/4','::/128','::1/128','fc00::/7','fe80::/10','ff00::/8']
config={'log':{'loglevel':'none','access':'none'},'inbounds':[{'tag':'private-chain','listen':address,'port':port,'protocol':'vless','settings':{'clients':[{'id':gateway['uuid'],'email':'private-chain-owner'}],'decryption':'none'},'streamSettings':{'network':'tcp','security':'none'}}],
 'outbounds':[{'tag':'block','protocol':'blackhole'},{'tag':'native','protocol':'freedom','settings':{'domainStrategy':'UseIP'}}],
 'routing':{'domainStrategy':'IPOnDemand','rules':[{'type':'field','ip':blocked,'outboundTag':'block'},{'type':'field','inboundTag':['private-chain'],'source':['100.64.0.0/10'],'network':'tcp,udp','outboundTag':'native'}]}}
target=directory/'config.json';target.write_text(json.dumps(config));os.chown(target,0,account.pw_gid);os.chmod(target,0o640)
guard='''#!/usr/bin/python3
import json,subprocess
from pathlib import Path
c=json.loads(Path('/etc/kenxu-chain/config.json').read_text())['inbounds'][0]
def ipt(*args,check=True):return subprocess.run(['/usr/sbin/iptables','-w','10',*args],check=check,capture_output=True)
ipt('-N','KENXU_CHAIN',check=False)
ipt('-F','KENXU_CHAIN')
ipt('-A','KENXU_CHAIN','-i','tailscale0','-j','ACCEPT')
ipt('-A','KENXU_CHAIN','-p','tcp','-j','REJECT','--reject-with','tcp-reset')
rule=['INPUT','-d',c['listen']+'/32','-p','tcp','--dport',str(c['port']),'-j','KENXU_CHAIN']
if ipt('-C',*rule,check=False).returncode:ipt('-I','INPUT','1',*rule[1:])
'''
(library/'guard.py').write_text(guard);os.chmod(library/'guard.py',0o755)
owner_guard='''#!/usr/bin/python3
import json,sqlite3,subprocess,time
from pathlib import Path
root=Path(ROOT_VALUE)
try:
 settings=json.loads((root/'private-data/jetson-chain.json').read_text())
 with sqlite3.connect((root/'private-data/portal.sqlite').as_uri()+'?mode=ro',uri=True,timeout=5) as db:
  owner=db.execute('SELECT role,enabled,must_change,expires_at FROM users WHERE id=?',(settings['ownerUserId'],)).fetchone()
 valid=owner and owner[0]=='user' and owner[1] and not owner[2] and (not owner[3] or owner[3]>time.time()*1000)
except Exception:
 valid=False
if not valid:
 subprocess.run(['systemctl','stop','kenxu-chain.service'],check=True)
'''.replace('ROOT_VALUE',repr(str(ROOT)))
(library/'owner-guard.py').write_text(owner_guard);os.chmod(library/'owner-guard.py',0o700)
units=pathlib.Path('/etc/systemd/system')
(units/'kenxu-chain-guard.service').write_text('''[Unit]
Description=Kenxu private Tailscale chain ingress guard
After=tailscaled.service
Before=kenxu-chain.service
[Service]
Type=oneshot
ExecStart=/usr/local/lib/kenxu-chain/guard.py
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
''')
(units/'kenxu-chain.service').write_text('''[Unit]
Description=Kenxu owner-only Tailscale first hop
After=network-online.target tailscaled.service kenxu-chain-guard.service
Wants=network-online.target tailscaled.service
Requires=kenxu-chain-guard.service
[Service]
User=kenxu-chain
Group=kenxu-chain
ExecStart=/usr/local/bin/xray run -config /etc/kenxu-chain/config.json
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
UMask=0077
[Install]
WantedBy=multi-user.target
''')
for name,body in {'kenxu-chain-owner-guard.service':'''[Unit]
Description=Revoke private hop when its owner is disabled or expires
[Service]
Type=oneshot
ExecStart=/usr/local/lib/kenxu-chain/owner-guard.py
''','kenxu-chain-owner-guard.timer':'''[Unit]
Description=Check private hop owner every minute
[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=1
Unit=kenxu-chain-owner-guard.service
[Install]
WantedBy=timers.target
'''}.items():(units/name).write_text(body)
run('/usr/local/bin/xray','run','-test','-config',str(target));run('systemctl','daemon-reload');run('systemctl','enable','--now','kenxu-chain-guard.service','kenxu-chain.service','kenxu-chain-owner-guard.timer');run('systemctl','start','kenxu-chain-owner-guard.service')
print(json.dumps({'gatewayInstalled':True,'tailnetOnly':True,'vlessIdentityRequired':True,'privateDestinationsBlocked':True,'existingCoreUnchanged':True}))
