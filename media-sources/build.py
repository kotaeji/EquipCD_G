import json,urllib.parse,urllib.request,re,io,time,os
from PIL import Image
UA="EquipCD-media-sourcing/1.0 (research; contact via the repository owner on GitHub)"
D=os.path.abspath('.')
photos={
 'cyl':'File:Pneumatic cylinder.jpg',
 'bcr':'File:Honeywell 4600g-8661.jpg',
 'conv':'File:Conveyor system in a factory.jpg',
 'gantry':'File:Robot Portico tecno-840.jpg',
 'picker':'File:Assembly line.jpg',
 'press':'File:Датчик давления.JPG',
 'photo':'File:SICK WL12G-3B2531 Photoelectric reflex switch angled1.png',
 'prox':'File:Pepperl+Fuchs inductive proximity switch 3RG4113-3AG33-PF.jpg',
 'limit':'File:Limit Switches.JPG',
 'ident':'File:Kommissionieren mit Barcode-Scanner Regallager.png',
 'paro':'File:PARO lineararm.jpg',
 'belt':'File:Horizontal Belt Conveyor.jpg',
}
def get(u):
  return urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':UA}),timeout=60).read()
clean=lambda s:re.sub(r'\s+',' ',re.sub('<[^>]+>','',s or '')).strip()
src={}
for k,t in photos.items():
  q="https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=900&titles="+urllib.parse.quote(t)
  p=list(json.loads(get(q))['query']['pages'].values())[0]; ii=p['imageinfo'][0]; m=ii['extmetadata']
  g=lambda n:clean(m.get(n,{}).get('value',''))
  img=Image.open(io.BytesIO(get(ii['thumburl'])))
  if img.mode in('RGBA','LA','P'):
    img=img.convert('RGBA'); bg=Image.new('RGB',img.size,'white'); bg.paste(img,mask=img.split()[3]); img=bg
  img=img.convert('RGB')
  if img.width>900: img=img.resize((900,round(img.height*900/img.width)),Image.LANCZOS)
  fn=os.path.join(D,'photos',k+'.jpg'); os.makedirs(os.path.dirname(fn),exist_ok=True)
  img.save(fn,'JPEG',quality=78,optimize=True,progressive=True)
  src[k]=dict(file=fn,sourcePageUrl=ii['descriptionurl'],originalImageUrl=ii['url'],resizedFromUrl=ii['thumburl'],title=p['title'],author=g('Artist'),credit=g('Credit'),license=g('LicenseShortName'),licenseUrl=m.get('LicenseUrl',{}).get('value') or None,usageTerms=g('UsageTerms'),description=g('ImageDescription')[:300],originalSize=[ii['width'],ii['height']],savedSize=list(img.size),bytes=os.path.getsize(fn))
  time.sleep(0.7)
json.dump(src,open('sources_raw.json','w'),ensure_ascii=False,indent=1)
for k,v in src.items(): print(k,v['license'],v['licenseUrl'],v['author'][:40],v['savedSize'],v['bytes'])
