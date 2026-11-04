import sys
from PIL import Image
ids=sys.argv[2:]; cols=3
rows=(len(ids)+cols-1)//cols
sh=Image.new('RGB',(cols*395+20,rows*545+20),(230,226,216))
for i,c in enumerate(ids):
  sh.paste(Image.open(f'XHS-{c}_card.png').resize((375,525)),(20+(i%cols)*395,20+(i//cols)*545))
sh.save(sys.argv[1])
