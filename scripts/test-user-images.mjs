import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'sample-images', 'user-uploaded-card-tests');
const files = (await fs.readdir(folder)).filter((name) => /\.(jpe?g|png|webp)$/i.test(name));
if (!files.length) throw new Error('No sample images were found.');
console.log(`Found ${files.length} user-provided test images.`);
const python = process.platform === 'win32' ? 'python' : 'python3';
const code = `
import sys, json, pathlib, cv2
sys.path.insert(0, ${JSON.stringify(path.join(root,'vision-worker'))})
from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.quality import analyze_image_quality
folder=pathlib.Path(${JSON.stringify(folder)})
rows=[]
for p in sorted(folder.iterdir()):
    if p.suffix.lower() not in {'.jpg','.jpeg','.png','.webp'}: continue
    try:
        img=decode_image(p.read_bytes())
        detections=detect_card_objects(img, allow_whole_image_fallback=True)
        quality=analyze_image_quality(img)
        rows.append({'file':p.name,'ok':True,'detections':len(detections),'quality_score':quality.quality_score,'warnings':quality.warnings})
    except Exception as e:
        rows.append({'file':p.name,'ok':False,'error':type(e).__name__+': '+str(e)})
print(json.dumps(rows))
`;
const child=spawn(python,['-c',code],{cwd:root});
let stdout='',stderr=''; child.stdout.on('data',d=>stdout+=d); child.stderr.on('data',d=>stderr+=d);
const exitCode=await new Promise((resolve)=>child.on('exit',resolve));
if(exitCode!==0){console.error(stderr);process.exit(exitCode||1)}
const rows=JSON.parse(stdout); const passed=rows.filter(r=>r.ok).length;
console.log(`Decoded ${passed}/${rows.length} images.`);
for(const row of rows) console.log(`${row.ok?'PASS':'FAIL'} ${row.file}${row.ok?` detections=${row.detections} quality=${row.quality_score}`:` ${row.error}`}`);
await fs.mkdir(path.join(root,'.runtime','image-tests'),{recursive:true});
await fs.writeFile(path.join(root,'.runtime','image-tests','user-images.json'),JSON.stringify({generatedAt:new Date().toISOString(),rows},null,2));
if(passed!==rows.length) process.exitCode=1;
