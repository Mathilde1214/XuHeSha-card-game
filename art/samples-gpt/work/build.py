from pathlib import Path
import fitz, cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path('/workspace/xuhesha/art/samples-gpt')
WORK=ROOT/'work'; WORK.mkdir(exist_ok=True)
PDF=Path('/workspace/xuhesha/xuhesha-cards-scan.pdf')
W,H=750,1050
BLUE=(31,63,168); RED=(214,40,40); PURPLE=(113,26,95); PAPER=(250,248,242)
FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
DOC=fitz.open(PDF)

# Re-render every required source at 300 dpi; retained scans are only in work/.
def render(n):
    path=WORK/f'page-{n}.png'
    DOC[n-1].get_pixmap(matrix=fitz.Matrix(300/72,300/72),alpha=False).save(path)
    return np.asarray(Image.open(path).convert('RGB'))
PAGES={n:render(n) for n in (1,25,36,58,68)}

def component_crop(n, box, kind='blue', margin=10, min_area=6):
    """Threshold ink in a semantic search window, use connected components to bound/cull it."""
    arr=PAGES[n]; x0,y0,x1,y1=map(int,box); crop=arr[y0:y1,x0:x1]
    r,g,b=np.moveaxis(crop,2,0)
    if kind=='blue':
        # Saturated blue ballpoint pigment; white paper/shadows and black effect writing fall out.
        mask=(b.astype(np.int16)>r.astype(np.int16)*1.25)&(b.astype(np.int16)>g.astype(np.int16)*1.12)&(b>60)&(r<155)
        alpha=np.clip((b.astype(float)-r.astype(float))*2.2,0,255).astype(np.uint8)
    elif kind=='dark':
        gray=cv2.cvtColor(crop,cv2.COLOR_RGB2GRAY)
        mask=gray<155
        alpha=np.clip((238-gray.astype(float))*1.65,0,255).astype(np.uint8)
    elif kind=='red':
        mask=(r>100)&(r.astype(np.int16)>g.astype(np.int16)*1.25)&(r.astype(np.int16)>b.astype(np.int16)*1.2)
        alpha=np.clip((r.astype(float)-g.astype(float))*2.0,0,255).astype(np.uint8)
    else: raise ValueError(kind)
    num,labels,stats,_=cv2.connectedComponentsWithStats(mask.astype(np.uint8),8)
    keep=np.zeros(mask.shape,dtype=bool)
    for i in range(1,num):
        x,y,w,h,area=stats[i]
        if area>=min_area: keep[labels==i]=True
    # Preserve smooth antialiased edges only around retained ink components.
    alpha=np.where(keep,alpha,0).astype(np.uint8)
    yy,xx=np.where(alpha>0)
    if not len(xx): raise RuntimeError(f'No {kind} ink found on page {n} in {box}')
    ax0=max(0,int(xx.min())-margin); ay0=max(0,int(yy.min())-margin)
    ax1=min(alpha.shape[1],int(xx.max())+1+margin); ay1=min(alpha.shape[0],int(yy.max())+1+margin)
    rgba=np.zeros((ay1-ay0,ax1-ax0,4),np.uint8)
    rgba[:,:,:3]=BLUE if kind!='red' else RED
    rgba[:,:,3]=alpha[ay0:ay1,ax0:ax1]
    return Image.fromarray(rgba,'RGBA')

def fit(dst, asset, box):
    x,y,w,h=box; im=asset.copy(); im.thumbnail((w,h),Image.Resampling.LANCZOS)
    dst.alpha_composite(im,(round(x+(w-im.width)/2),round(y+(h-im.height)/2)))

def font(size): return ImageFont.truetype(FONT,size,index=0)

def text_width(draw,s,ft):
    return draw.textbbox((0,0),s,font=ft)[2]

def wrap_text(draw, text, ft, maxw):
    lines=[]; line=''
    for ch in text:
        if ch=='\n': lines.append(line); line=''; continue
        if line and text_width(draw,line+ch,ft)>maxw: lines.append(line); line=ch
        else: line+=ch
    if line: lines.append(line)
    return lines

def effect_layout(im,effect,heart):
    d=ImageDraw.Draw(im); box=(50,640,650,260); x,y,w,h=box
    # Tokenize HP so the real page-68 heart is placed inline at the font's cap height.
    tokens=effect.split('HP')
    ft=font(29)
    items=[]
    for i,t in enumerate(tokens):
        for ch in t:
            if ch=='\n': items.append(('break',''))
            else: items.append(('text',ch))
        if i<len(tokens)-1: items.append(('heart',''))
    # Slightly enlarge and embolden the traced HP mark so it survives at card size.
    heart_h=38; heart_w=40
    lines=[]; current=[]; used=0
    for typ,val in items:
        if typ=='break':
            if current: lines.append(current)
            current=[]; used=0
            continue
        width=text_width(d,val,ft) if typ=='text' else heart_w
        if current and used+width> w:
            lines.append(current); current=[]; used=0
        current.append((typ,val,width)); used+=width
    if current: lines.append(current)
    line_h=48; total=len(lines)*line_h; yy=y+(h-total)/2
    for line in lines:
        xx=x
        for typ,val,width in line:
            if typ=='text':
                d.text((xx,yy),val,font=ft,fill=BLUE); xx+=width
            else:
                icon=heart.copy(); icon.thumbnail((heart_w,heart_h),Image.Resampling.LANCZOS)
                a=np.asarray(icon.getchannel('A'))
                a=cv2.dilate(a,np.ones((3,3),np.uint8),iterations=1)
                icon.putalpha(Image.fromarray(a))
                im.alpha_composite(icon,(int(xx),int(yy+3))); xx+=heart_w
        yy+=line_h

def hand_frame(draw, color):
    # One continuous rounded rectangle, interrupted by only a few pixels at each corner.
    # Small deterministic perturbations give the line a hand-drawn feel.
    rng=np.random.default_rng(18)
    left,top,right,bottom=18,18,732,1032
    radius=28
    corners=[(right-radius,top+radius,-90,0),
             (right-radius,bottom-radius,0,90),
             (left+radius,bottom-radius,90,180),
             (left+radius,top+radius,180,270)]
    # clockwise perimeter parts: top, right, bottom, left, each followed by its rounded corner
    parts=[([(left+radius,top),(right-radius,top)],False,corners[0]),
           ([(right,top+radius),(right,bottom-radius)],False,corners[1]),
           ([(right-radius,bottom),(left+radius,bottom)],False,corners[2]),
           ([(left,bottom-radius),(left,top+radius)],False,corners[3])]
    for (p0,p1),_,(cx,cy,a0,a1) in parts:
        straight=[]
        # Mild wobble sampled along each long edge.
        steps=max(2,int(max(abs(p1[0]-p0[0]),abs(p1[1]-p0[1]))/90))
        for i in range(steps+1):
            t=i/steps
            x=p0[0]+t*(p1[0]-p0[0]); y=p0[1]+t*(p1[1]-p0[1])
            if i not in (0,steps):
                x+=float(rng.normal(0,0.8)); y+=float(rng.normal(0,0.8))
            straight.append((round(x),round(y)))
        draw.line(straight,fill=BLUE,width=6,joint='curve')
        # The arc stops 3 degrees short at both ends, leaving a very small corner opening.
        arc=[]
        for deg in np.linspace(a0+3,a1-3,15):
            rad=np.deg2rad(deg)
            rr=radius+float(rng.normal(0,0.45))
            arc.append((round(cx+rr*np.cos(rad)),round(cy+rr*np.sin(rad))))
        draw.line(arc,fill=color,width=6,joint='curve')

def cost_icon(n, box, target=(620,40,96,96)):
    icon=component_crop(n,box,'dark',margin=8,min_area=14)
    # recolor extracted hand-drawn ring and numeral to SP purple, retaining original outline.
    arr=np.asarray(icon).copy(); arr[:,:,:3]=PURPLE
    fit_current=Image.fromarray(arr,'RGBA')
    x,y,w,h=target; fit_current.thumbnail((w,h),Image.Resampling.LANCZOS)
    return fit_current,(round(x+(w-fit_current.width)/2),round(y+(h-fit_current.height)/2))

def make_card(id,n,name,typ,cost,effect,quote,tags,title_box,art_box,quote_box,cost_box):
    im=Image.new('RGBA',(W,H),PAPER+(255,)); d=ImageDraw.Draw(im)
    type_colors={'攻击':RED,'防御':BLUE,'资源':(42,157,80),'效果':(224,123,0)}; tcol=type_colors[typ]
    hand_frame(d,tcol)
    title=component_crop(n,title_box,'blue',margin=20,min_area=18)
    title.thumbnail((560,110),Image.Resampling.LANCZOS)
    im.alpha_composite(title,(40,36))
    mark,pos=cost_icon(*cost_box); im.alpha_composite(mark,pos)
    d=ImageDraw.Draw(im)
    d.ellipse((43,160,63,180),fill=tcol)
    d.text((75,151),typ,font=font(25),fill=BLUE)
    x=150
    for tag in tags.split('|'):
        if not tag: continue
        ft=font(17); tw=text_width(d,tag,ft)
        d.rounded_rectangle((x,155,x+tw+22,185),radius=12,outline=BLUE,width=2)
        d.text((x+11,157),tag,font=ft,fill=BLUE)
        x+=tw+31
    art=component_crop(n,art_box,'blue',margin=14,min_area=20)
    fit(im,art,(40,200,670,420))
    effect_layout(im,effect,HEART)
    if quote:
        q=component_crop(n,quote_box,'dark',margin=18,min_area=6)
        # clean handwritten quote from scan, recolored to ballpoint blue.
        fit(im,q,(50,920,650,90))
    if typ=='效果':
        # dashed inner frame denotes an ongoing effect card
        d=ImageDraw.Draw(im)
        
        # Inner dashed treatment begins below the title and tag row.
        x0,y0,x1,y1=34,198,716,1018
        for xx in range(x0+24,x1-10,30):
            d.line((xx,y0,min(xx+16,x1-10),y0),fill=BLUE,width=2)
            d.line((xx,y1,min(xx+16,x1-10),y1),fill=BLUE,width=2)
        for yy in range(y0+24,y1-10,30):
            d.line((x0,yy,x0,min(yy+16,y1-10)),fill=BLUE,width=2)
            d.line((x1,yy,x1,min(yy+16,y1-10)),fill=BLUE,width=2)
    out=im.convert('RGB'); out.save(ROOT/f'{id}_card.png')
    return out

# Exact component-search windows follow each page's handwritten title/art/quote rows; bounds come from CCs.
HEART=component_crop(68,(580,1000,800,1250),'red',margin=6,min_area=12)
HEART.save(WORK/'hp-heart.png')
C0=component_crop(36,(1920,500,2320,850),'dark',margin=8,min_area=14)
C0.save(WORK/'cost-zero-source.png')
# Keep requested shared ⓪ and source circled numerals as transparent extracted assets.

cards=[
 ('XHS-001',1,'小绿','防御','0','防御一次攻击，但失去下一次出牌机会。','今天的作业：小绿','可燃',(560,130,1800,600),(320,1120,1350,2380),(180,2460,2380,3180),(36,(1920,500,2320,850))),
 ('XHS-025',25,'林广秦','攻击','1','使敌 HP+1。','很可爱，不是吗?','3119',(760,130,1740,590),(380,1000,2000,2200),(120,2380,2420,3250),(25,(1820,490,2220,900))),
 ('XHS-058',58,'电竞室!','效果','3','持续有效。所有与3118有关手牌的有益效果×2。','','3118',(250,90,1600,540),(350,560,2250,2540),(0,0,1,1),(58,(1770,150,2200,580))),
]
outs=[]
for id,n,name,typ,cost,effect,quote,tags,title_box,art_box,quote_box,cost_box in cards:
    outs.append(make_card(id,n,name,typ,cost,effect,quote,tags,title_box,art_box,quote_box,cost_box))
prev=Image.new('RGB',(2250,1050),PAPER)
for i,img in enumerate(outs): prev.paste(img,(i*750,0))
prev.save(ROOT/'preview.png')
# Inspectable zooms of title/cost/art on each generated card.
for id,img in zip([c[0] for c in cards],outs):
    img.crop((0,0,750,200)).resize((1500,400)).save(WORK/f'{id}-top-zoom.png')
    img.crop((25,190,725,630)).resize((1050,660)).save(WORK/f'{id}-art-zoom.png')
