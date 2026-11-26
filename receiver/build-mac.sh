#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
mkdir -p build/MicTurn-Receiver/Third-party-licenses ../public/downloads
CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o build/receiver-arm64 .
CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o build/receiver-amd64 .
lipo -create build/receiver-arm64 build/receiver-amd64 -output build/MicTurn-Receiver/micturn-receiver
codesign --force --sign - build/MicTurn-Receiver/micturn-receiver
cp 'Start Receiver.command' README.md build/MicTurn-Receiver/
chmod 755 build/MicTurn-Receiver/micturn-receiver 'build/MicTurn-Receiver/Start Receiver.command'
go list -m -json all > build/modules.json
python3 - <<'PY'
import hashlib,json,pathlib,shutil,zipfile
base=pathlib.Path('build'); text=(base/'modules.json').read_text(); decoder=json.JSONDecoder(); modules=[]
while text.strip():
    value,end=decoder.raw_decode(text.lstrip());modules.append(value);text=text.lstrip()[end:]
target=base/'MicTurn-Receiver'/'Third-party-licenses'
for m in modules:
    if m.get('Main') or not m.get('Dir'): continue
    directory=pathlib.Path(m['Dir'])
    for source in directory.iterdir():
        if source.is_file() and source.name.upper().startswith(('LICENSE','COPYING','NOTICE')):
            shutil.copyfile(source,target/(m['Path'].replace('/','_')+'_'+source.name))
(target/'modules.json').write_text(json.dumps([{k:m[k] for k in ('Path','Version','Sum') if k in m} for m in modules],indent=2)+'\n')
archive=pathlib.Path('../public/downloads/MicTurn-Receiver-macOS.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted((base/'MicTurn-Receiver').rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(base))
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.parent/'SHA256SUMS.txt').write_text(digest+'  '+archive.name+'\n')
print(archive,archive.stat().st_size,'bytes',digest)
PY
