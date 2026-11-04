import numpy as np, json, sys
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
sys.path.insert(0,'.')
import importlib.util
P='assets/pages/'
f=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',22)
out={}
for n in range(1,68):
    img=Image.open(f'{P}pg-{n:02d}.png').convert('RGB')
    if img.size!=(2480,3509): img=img.resize((2480,3509))
    sm=img.resize((620,877))  # quarter res
    im=np.asarray(sm).astype(float); g=im.mean(2)
    bg=ndimage.maximum_filter(g,size=25); bg=ndimage.uniform_filter(bg,9)
    nm=np.clip(im/np.maximum(bg,1)[...,None]*255,0,255)
    lum=nm.mean(2); r,gg,b=nm[...,0],nm[...,1],nm[...,2]; sat=nm.max(2)-nm.min(2)
    ink=lum<175
    blue=ink&(b-r>25)
    black=ink&~blue&(sat<70)
    # drop frame borders on photo pages: ignore 2% margin
    for m in (blue,black):
        m[:18,:]=0; m[-18:,:]=0; m[:,:12]=0; m[:,-12:]=0
        m[790:,500:]=0  # watermark
    regs=[]
    for col,m in (('B',blue),('K',black)):
        m=ndimage.binary_opening(m,iterations=1) if col=='K' else m
        d=ndimage.binary_dilation(m,structure=np.ones((11,19)) if col=="K" else np.ones((15,15)))
        lab,nl=ndimage.label(d)
        for sl in ndimage.find_objects(lab):
            ys,xs=sl
            area=m[sl].sum()
            if area<25: continue
            regs.append((col,xs.start,ys.start,xs.stop,ys.stop))
    regs.sort(key=lambda t:(t[2],t[1]))
    out[n]=[[c,x0*4,y0*4,x1*4,y1*4] for c,x0,y0,x1,y1 in regs]
    vis=sm.copy(); d=ImageDraw.Draw(vis)
    for i,(c,x0,y0,x1,y1) in enumerate(regs):
        cc=(0,160,0) if c=='B' else (230,0,0)
        d.rectangle([x0,y0,x1,y1],outline=cc,width=2)
        d.text((x0+2,y0+1),str(i),font=f,fill=cc,stroke_width=2,stroke_fill='white')
    d.text((540,840),f'P{n}',font=f,fill=(255,0,255))
    vis.save(f'assets/check/seg{n:02d}.png')
json.dump(out,open('assets/check/segments.json','w'))
