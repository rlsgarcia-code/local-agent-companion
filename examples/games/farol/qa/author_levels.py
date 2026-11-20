"""Authored static campaign; solve using rotations, never a gameplay debug port."""
from collections import deque
import json
from pathlib import Path
D=[(1,0),(0,1),(-1,0),(0,-1)]
def m(x,y,o=0,locked=False):return {'x':x,'y':y,'kind':'mirror','rotation':(o+1)%2,'solution':o,'locked':locked}
def s(x,y,o=0):return {'x':x,'y':y,'kind':'split','rotation':(o+2)%4,'solution':o}
def l(x,y,o=0):return {'x':x,'y':y,'kind':'lens','rotation':(o+1)%2,'solution':o}
def wall(x,y):return {'x':x,'y':y,'kind':'wall','rotation':0,'solution':0,'locked':True}
def level(name,chapter,source,targets,tiles,tip,w=7,h=7):
 for t in tiles:
  if t.get('locked'):t['rotation']=t['solution']
 return {'id':len(LEVELS)+1,'title':name,'chapter':chapter,'width':w,'height':h,'source':{'x':source[0],'y':source[1],'direction':0},
 'targets':[{'id':f'beacon-{i}','x':p[0],'y':p[1]} for i,p in enumerate(targets)],'tiles':tiles,'tip':tip}
LEVELS=[]
def add(*args,**kw):LEVELS.append(level(*args,**kw))
add('Primeira luz',0,(0,3),[(3,0)],[m(3,3)],'Toque no espelho para girar. Leve a luz ao farol.',w=6,h=5)
add('Duas curvas',0,(0,1),[(6,4)],[m(2,1,1),m(2,4,1)],'Cada espelho muda o caminho em um quarto de volta.',h=6)
add('A enseada',0,(0,5),[(5,6)],[m(1,5),m(1,1),m(5,1,1)],'Siga o feixe a partir da pequena estrela.')
add('Vidro do mar',0,(0,4),[(5,0)],[l(2,4),m(5,4),wall(4,1)],'A lente só deixa passar a luz na direção da abertura.')
add('Luz partilhada',1,(0,2),[(6,2),(3,5)],[s(3,2)],'O divisor tem três entradas. Acenda os dois faróis.',h=6)
add('Outra margem',1,(0,2),[(6,2),(0,5)],[s(3,2),m(3,5)],'Girar uma peça pode mudar mais de um caminho.',h=6)
add('O desvio',1,(0,1),[(6,1),(5,6)],[l(1,1),s(3,1),m(3,4,1),m(5,4,1)],'Uma lente fechada interrompe todo o caminho que vem depois.')
add('Duas alturas',1,(0,5),[(1,0),(5,6)],[m(1,5),s(1,2,3),m(5,2,1)],'Os divisores também recebem luz de cima ou de baixo.')
add('Pedra antiga',2,(0,3),[(5,0),(6,6)],[s(2,3),l(4,3),m(5,3,0,True),m(2,6,1)],'Peças com ponto de cobre são fixas. Use o caminho que elas oferecem.')
add('Três ilhas',2,(0,1),[(6,1),(1,5),(2,6)],[s(2,1),s(5,1),m(5,5)],'Um divisor pode alimentar outro divisor.')
add('Volta ao mar',2,(0,3),[(2,6)],[s(2,3),m(2,1,0,True),m(5,1,1,True),m(5,3,0,True),l(2,5,1)],'Um circuito pode devolver a luz. Nem todo caminho chega a um farol.')
add('Portas de vidro',2,(0,3),[(6,0),(6,6)],[s(2,3),l(4,3),m(6,3),l(2,5,1),m(2,6,1),wall(4,1),wall(5,5)],'Observe o último lugar onde a luz parou.')
add('Arquipélago',3,(0,5),[(1,0),(6,2),(5,6)],[m(1,5),s(1,2,3),l(3,2),s(5,2),l(5,4,1)],'Primeiro divida a luz; depois ajuste cada ramificação.')
add('Caminhos cruzados',3,(0,1),[(5,6),(2,6),(0,4)],[s(2,1),m(5,1,1),l(5,3,1),s(5,4,1),l(3,4),m(2,4)],'Dois feixes podem cruzar a mesma peça em direções diferentes.')
add('Última maré',3,(0,3),[(1,1),(4,2),(6,6)],[s(2,3),m(6,3),m(6,1,1),m(2,6,1),l(3,6),s(4,6,2),l(4,4,1)],'Um bom caminho mantém todas as ilhas acesas ao mesmo tempo.')
add('Noite clara',3,(0,3),[(6,3),(2,0),(5,4),(6,6)],[s(2,3),l(4,3),s(5,3,2),l(5,1,1),m(5,0,1),m(2,6,1),l(4,6),s(5,6,2),wall(3,1),wall(1,5)],'Todo o arquipélago espera a sua luz. Experimente, desfaça, encontre o caminho.')

def trace(v,state):
 tiles={(t['x'],t['y']):(i,t) for i,t in enumerate(v['tiles'])};targets={(t['x'],t['y']) for t in v['targets']}
 source=(v['source']['x'],v['source']['y']);queue=[(*source,0)];seen=set();lit=set()
 for x,y,d in queue:
  if (x,y,d) in seen:continue
  seen.add((x,y,d));dx,dy=D[d];p=(x+dx,y+dy)
  if not (0<=p[0]<v['width'] and 0<=p[1]<v['height']):continue
  if p in targets:lit.add(p);continue
  if p==source:continue
  if p not in tiles:queue.append((*p,d));continue
  i,t=tiles[p];o=state[i]
  if t['kind']=='mirror':queue.append((*p,((3,2,1,0) if o%2==0 else (1,0,3,2))[d]))
  elif t['kind']=='lens' and d%2==o%2:queue.append((*p,d))
  elif t['kind']=='split':
   ports=[(o+j)%4 for j in range(3)];incoming=(d+2)%4
   if incoming in ports:queue.extend((*p,q) for q in ports if q!=incoming)
 return lit==targets

def solve(v):
 start=tuple(t['rotation'] for t in v['tiles']);queue=deque([(start,[])]);seen={start}
 while queue:
  state,path=queue.popleft()
  if trace(v,state):return path,len(seen)
  for i,t in enumerate(v['tiles']):
   if t.get('locked') or t['kind']=='wall':continue
   n=4 if t['kind']=='split' else 2
   for d in ([1,-1] if n==4 else [1]):
    changed=list(state);changed[i]=(state[i]+d)%n;changed=tuple(changed)
    if changed not in seen:seen.add(changed);queue.append((changed,path+[{'tile':i,'direction':d}]))
 raise RuntimeError('Unsolvable '+v['title'])

root=Path(__file__).resolve().parents[1];solutions=[]
for v in LEVELS:
 used={(v['source']['x'],v['source']['y'])}
 for t in v['targets']+v['tiles']:
  p=(t['x'],t['y'])
  if p in used:raise RuntimeError('Overlapping '+v['title']+' '+str(p))
  used.add(p)
 intended=[t['solution'] for t in v['tiles']]
 if not trace(v,intended):raise RuntimeError('Intended route invalid '+v['title'])
 path,states=solve(v)
 if not path:raise RuntimeError('Already solved '+v['title'])
 v['par']=len(path);solutions.append({'id':v['id'],'actions':path,'statesExplored':states})
 for t in v['tiles']:t.pop('solution')
 print(v['id'],v['title'],'par',len(path),'states',states)
(root/'data/levels.json').write_text(json.dumps({'schemaVersion':1,'chapters':['A costa','Marés','Duas margens','Noite clara'],'levels':LEVELS},ensure_ascii=False,indent=2)+'\n')
(root/'qa/solutions.json').write_text(json.dumps(solutions,ensure_ascii=False,indent=2)+'\n')
