/* Exercise the actual mod callbacks against bounded guest RAM. */
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include "../runtime/mods/launch_match.c"
static unsigned char ram[24*1024*1024];
static uint64_t rd(CPUState*s,uint32_t p,uint8_t n){(void)s;assert(p>=0x80000000&&p+n<=0x81800000);uint64_t v=0;for(unsigned i=0;i<n;i++)v=v*256+ram[p-0x80000000+i];return v;}
static void wr(CPUState*s,uint32_t p,uint64_t v,uint8_t n){(void)s;assert(p>=0x80000000&&p+n<=0x81800000);for(unsigned i=n;i;i--){ram[p-0x80000000+i-1]=v;v>>=8;}}
static void w(CPUState*s,unsigned p,unsigned v){wr(s,p,v,4);}
int main(void){
 CPUState s={0};s.external_read=rd;s.external_write=wr;
 css_registry=0x81000000;css_count=2;css_pages=3;css_page=1;
 for(unsigned i=1;i<=2;i++){unsigned r=css_row(i);w(&s,r,8);w(&s,r+4,i);w(&s,r+8,i);w(&s,r+12,317+i);w(&s,r+24,0x81001000+i*32);}
 assert(css_for_slot(&s,8,1)==1);assert(css_for_slot(&s,8,2)==2);assert(css_for_slot(&s,8,0)==0);
 w(&s,0x804D6CB0,0x81010000);write8(&s,0x804D6CF5,4);
 w(&s,CSS_ICONS+28+8,0xcd);write8(&s,CSS_ICONS+28+1,8);
 for(unsigned door=0;door<2;door++){
  write8(&s,CSS_DOORS+door*0x24+0xe,1);w(&s,0x804A0BD0+door*4,0x81020000+door*32);write8(&s,0x81020000+door*32+5,1);
  s.gpr[3]=door;css_page=door+1;css_door_identity(&s);css_exit_identity(&s);
 }
 assert(css_selected[0]==1&&css_selected[1]==2);
 assert(css_get8(&s,css_player(&s,0)+3)==1&&css_get8(&s,css_player(&s,1)+3)==2);
 /* A later page or native duplicate-color update must not change confirmed identity. */
 write8(&s,0x81020000+5,0);css_page=0;s.gpr[3]=0;css_door_identity(&s);write8(&s,css_player(&s,0)+3,0);css_exit_identity(&s);
 assert(css_selected[0]==1&&css_get8(&s,css_player(&s,0)+3)==1);
 /* Voice scripts are asynchronous: identity belongs to their track. */
 css_current_door=1;s.gpr[3]=0xcd;s.gpr[6]=0x8b;css_announce(&s);
 s.gpr[9]=0x8b;s.gpr[3]=300;css_voice_patch(&s);assert(s.gpr[3]==319&&s.pc==0x803896F4);
 /* Vanilla announcement replaces the pending custom on the same track. */
 css_selected[1]=0;s.gpr[3]=0xcd;s.gpr[6]=0x8b;css_announce(&s);
 s.gpr[3]=300;css_voice_patch(&s);assert(s.gpr[3]==0x7005);
 s.gpr[3]=8;s.gpr[31]=0;s.lr=0x8025DBEC;css_name_patch(&s);assert(s.gpr[3]==0x81001020&&s.pc==s.lr);
 s.gpr[3]=8;s.lr=0x80001000;css_name_patch(&s);assert(s.pc==0x80160984&&s.gpr[0]==s.lr);
 /* Temporary draw fields restore in reverse order, even when aliased. */
 w(&s,0x81040000,123);css_draw_write(&s,0x81040000,456);css_draw_write(&s,0x81040000,789);css_draw_end(&s);assert(rd(&s,0x81040000,4)==123);
 css_exited_identity(&s);assert(!css_registry&&!css_count);
 /* Scene re-entry discovers a fresh registry and restores selected colors. */
 w(&s,0x804D6CD0,0x81060000);w(&s,0x81060020,0x81000000);
 w(&s,0x81060028,0x81061000);w(&s,0x8106000c,1);w(&s,0x81061000,0);
 w(&s,0x81000000,0x4f534353);w(&s,0x81000004,1);w(&s,0x81000008,2);w(&s,0x8100000c,3);
 write8(&s,css_player(&s,0),8);write8(&s,css_player(&s,0)+3,1);
 write8(&s,css_player(&s,1),8);write8(&s,css_player(&s,1)+3,2);
 css_enter_identity(&s);assert(css_count==2&&css_selected[0]==1&&css_selected[1]==2&&css_page==1);
 /* Recursive DispAll returns must not restore the outer CSS overrides early. */
 css_draw_write(&s,0x81040000,999);s.lr=0x80370a00;css_draw_root_end(&s);assert(rd(&s,0x81040000,4)==999);
 s.lr=0x803910a0;css_draw_root_end(&s);assert(rd(&s,0x81040000,4)==123);
 css_exited_identity(&s);
 /* Every boot route redirects at most once; Full Boot keeps native menus. */
 for(unsigned mode=0;mode<5;mode++){
  requested=1;launch_mode=mode;routed=0;prepared=0;classic_prepared=0;
  s.gpr[3]=9;change_mode(&s);
  assert(css_get8(&s,0x80479D31)==(mode==4?9:mode==1?1:mode==3?3:2));
  s.gpr[3]=7;change_mode(&s);assert(css_get8(&s,0x80479D31)==7);
  w(&s,0x804D3EE0,0x81050000);
  port_config[0]=8|(2<<16);port_config[1]=8|256|(1<<16);
  vs_on_load(&s);
  assert(css_get8(&s,0x81050000+0x5f8+3)==2);
  write8(&s,0x81050000+0x5f8+3,4);vs_on_load(&s);
  assert(css_get8(&s,0x81050000+0x5f8+3)==4);
  classic_enter(&s);
  if(mode==3){
   assert(css_get8(&s,0x81050000+0x51e)==2);
   write8(&s,0x81050000+0x51e,4);classic_enter(&s);
   assert(css_get8(&s,0x81050000+0x51e)==4);
  }
 }
 puts("CSS runtime identity tests passed");
}
