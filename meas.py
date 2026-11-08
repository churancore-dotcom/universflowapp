import numpy as np,sys
x=np.fromfile('in.raw',dtype='<i2').reshape(-1,2).astype(np.float32)
for k in sys.argv[1:]:
    kind,wet=k.split(':')
    y=np.fromfile(f'o_{kind}.raw',dtype='>f4').reshape(-1,2)
    g=(x*y).sum()/(x*x).sum()
    r=y-g*x
    dr=10*np.log10((r**2).sum()/((g*x)**2).sum())
    print(f"{kind:10s} wet={wet} dryGain={g:.2f} reverb-vs-dry={dr:6.1f} dB peak={np.abs(y).max()/32768:.2f}")
