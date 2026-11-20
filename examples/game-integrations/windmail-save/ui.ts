import './recovery.css';
export type Choice={label:string;run:()=>void;secondary?:boolean};
export class VoyageRecoveryUI{
  private readonly layer=document.createElement('div');private readonly panel=document.createElement('section');
  private readonly heading=document.createElement('h1');private readonly detail=document.createElement('p');
  private readonly actions=document.createElement('div');private readonly status=document.createElement('p');
  private prior:HTMLElement|null=null;
  constructor(){
    this.layer.className='wm-recovery-layer';this.layer.hidden=true;this.panel.className='wm-recovery-panel';
    this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-labelledby','wm-recovery-title');
    const brand=document.createElement('p');brand.className='wm-recovery-brand';brand.textContent='CORREIO DAS CORRENTES';
    this.heading.id='wm-recovery-title';this.detail.className='wm-recovery-detail';this.actions.className='wm-recovery-actions';
    this.panel.append(brand,this.heading,this.detail,this.actions);this.layer.append(this.panel);
    this.status.id='wm-save-status';this.status.className='wm-save-status';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    this.layer.addEventListener('keydown',event=>{
      event.stopPropagation();if(event.key!=='Tab')return;
      const buttons=[...this.actions.querySelectorAll('button')];if(!buttons.length)return;
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length;event.preventDefault();buttons[next]!.focus();
    });
    document.body.append(this.layer,this.status);
  }
  get isOpen(){return !this.layer.hidden;}
  show(title:string,detail:string,choices:Choice[]){
    if(!this.isOpen)this.prior=document.activeElement as HTMLElement;
    this.heading.textContent=title;this.detail.textContent=detail;this.actions.replaceChildren();
    for(const choice of choices){const button=document.createElement('button');button.type='button';button.textContent=choice.label;button.className=choice.secondary?'wm-recovery-secondary':'';button.addEventListener('click',()=>choice.run());this.actions.append(button);}
    this.layer.hidden=false;(this.actions.firstElementChild as HTMLElement|null)?.focus();
  }
  hide(){this.layer.hidden=true;const canvas=document.querySelector('canvas');canvas?.setAttribute('tabindex','0');(this.prior?.isConnected?this.prior:canvas as HTMLElement|null)?.focus({preventScroll:true});}
  message(text:string,saving=false){this.status.textContent=text;this.status.classList.toggle('is-saving',saving);}
  destroy(){this.layer.remove();this.status.remove();}
}
