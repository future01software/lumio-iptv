from PIL import Image
import os

paths = ["adaptive-icon.png", "icon.png"]

for p in paths:
    if os.path.exists(p):
        img = Image.open(p).convert("RGBA")
        w, h = img.size
        new_img = Image.new("RGBA", (w, h), (0,0,0,0))
        
        scale = 0.65
        new_w, new_h = int(w * scale), int(h * scale)
        scaled_img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        pos = ((w - new_w)//2, (h - new_h)//2)
        new_img.paste(scaled_img, pos)
        new_img.save(p)
        print(f"Resized {p}")
