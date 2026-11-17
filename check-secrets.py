"""Pattern scan tracked/staged/history text; report counts, never credential values."""
import re,subprocess,sys
patterns=[r'https://discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]{20,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b',r'\bS[A-Z2-7]{55}\b']
def git(*args):return subprocess.run(['git',*args],check=True,capture_output=True,text=True).stdout
content=git('log','--all','-p','--format=')+'\n'+git('diff','--cached')
for path in git('ls-files').splitlines():
 try:content+='\n'+open(path,encoding='utf8').read()
 except (UnicodeError,OSError):pass
count=sum(len(re.findall(pattern,content)) for pattern in patterns)
print('Credential-pattern matches:',count);sys.exit(1 if count else 0)
