/* GALE01 revision 2 only. Addresses and layouts are from the matching decomp.
 * Configure VS, then let the real CSS/SSS preloaders run before combat.
 * Keep original fighter code, combat, results and subsequent menus. */
#include "moderngekko/mod_abi.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int original_pacing = 0;
static int launch_mode = 0, cpu_level = 5, routed = 0, destination_ready = 0;
static unsigned port_config[4] = {8, 12 | 256, 2 | 768, 9 | 768};
static int fighter = 8, opponent = 12, arena = 31, stocks = 4, minutes = 8;
static void validate_config(void) {
    if (launch_mode < 0 || launch_mode > 4 || arena < 2 || arena > 32 || arena == 21 || arena == 26 ||
        cpu_level < 1 || cpu_level > 9 || stocks < 1 || stocks > 99 || minutes < 0 || minutes > 99) abort();
    int active = 0;
    for (int i=0;i<4;i++) {
        unsigned role=(port_config[i]>>8)&255, color=port_config[i]>>16;
        if ((port_config[i]&255)>25 || (role!=0 && role!=1 && role!=3) || color>5) abort();
        if(role!=3)active++;
    }
    if(launch_mode==0 && active<2)abort();
}
int opensmash_destination_ready(void) { return destination_ready || original_pacing; }
#ifdef __EMSCRIPTEN__
#include <stdatomic.h>
#include <emscripten.h>
#include <emscripten/threading.h>
static const char* costume_names[] = {"PlMrNr.dat", "PlMrYe.dat", "PlMrBk.dat", "PlMrBu.dat", "PlMrGr.dat", "PlLgNr.dat", "PlLgWh.dat", "PlLgAq.dat", "PlLgPi.dat", "PlCaNr.dat", "PlCaGy.dat", "PlCaRe.dat", "PlCaWh.dat", "PlCaGr.dat", "PlCaBu.dat", "PlFxNr.dat", "PlFxOr.dat", "PlFxLa.dat", "PlFxGr.dat", "PlMsNr.dat", "PlMsRe.dat", "PlMsGr.dat", "PlMsBk.dat", "PlMsWh.dat", "PlLkNr.dat", "PlLkRe.dat", "PlLkBu.dat", "PlLkBk.dat", "PlLkWh.dat"};
static unsigned costume_sizes[29];
EMSCRIPTEN_KEEPALIVE void opensmash_costume_size(unsigned slot,unsigned size) {if(slot<sizeof(costume_sizes)/sizeof(costume_sizes[0]) && size>=32 && size<=2097152)costume_sizes[slot]=size;else abort();}
static atomic_uint combat_frames;
static atomic_int selected_fighter = -1;
EMSCRIPTEN_KEEPALIVE unsigned opensmash_combat_frames(void) { return atomic_load(&combat_frames); }
EMSCRIPTEN_KEEPALIVE void opensmash_choose_fighter(int choice) {
    if (choice < 0 || choice > 25) return;
    atomic_store(&selected_fighter, choice);
    emscripten_futex_wake(&selected_fighter, 1);
}
EMSCRIPTEN_KEEPALIVE void opensmash_configure_launch(int mode,int stage,int level,int stock,int mins,
                                                   unsigned p0,unsigned p1,unsigned p2,unsigned p3) {
    launch_mode=mode;arena=stage;cpu_level=level;stocks=stock;minutes=mins;
    port_config[0]=p0;port_config[1]=p1;port_config[2]=p2;port_config[3]=p3;
    validate_config();opensmash_choose_fighter(p0&255);
}
#endif

static int requested = 0, prepared = 0, launched = 0, css_frames = 0;

static unsigned read32(CPUState* s, unsigned address) {
    return (unsigned)moderngekko_mod_read(s, address, 4);
}
static void write8(CPUState* s, unsigned address, unsigned value) {
    moderngekko_mod_write(s, address, value, 1);
}
static int setting(const char* name, int fallback, int minimum, int maximum) {
    const char* raw = getenv(name);
    if (!raw) return fallback;
    char* end;
    long value = strtol(raw, &end, 10);
    if (*end || value < minimum || value > maximum) {
        fprintf(stderr, "Invalid %s\n", name);
        abort();
    }
    return (int)value;
}
static void on_load(const ModernGekkoModHostApi* api) {
    (void)api;
    requested = getenv("OPENSMASH_MATCH") != NULL;
    fighter = setting("OPENSMASH_FIGHTER", 8, 0, 25);
    opponent = setting("OPENSMASH_OPPONENT", 12, 0, 25);
    arena = setting("OPENSMASH_STAGE", 31, 2, 32);
    if (arena == 21 || arena == 26) abort();
    stocks = setting("OPENSMASH_STOCKS", 4, 1, 99);
    minutes = setting("OPENSMASH_MINUTES", 8, 0, 99);
    launch_mode=setting("OPENSMASH_MODE",0,0,4);
    cpu_level=setting("OPENSMASH_CPU_LEVEL",5,1,9);
    port_config[0]=fighter | (setting("OPENSMASH_P1_CPU",0,0,1)<<8);
    port_config[1]=opponent | 256;
    for(int i=0;i<4;i++) {
        char name[32];snprintf(name,sizeof(name),"OPENSMASH_PORT%d",i);
        port_config[i]=setting(name,port_config[i],0,0x50319);
    }
    validate_config();
}
static void mark_ready(void) {
    if(!destination_ready){destination_ready=1;fprintf(stderr,"[opensmash] destination ready mode=%d\n",launch_mode);}
}
static void scene_main(CPUState* s) {
    (void)s;
#ifdef __EMSCRIPTEN__
    if(getenv("OPENSMASH_WAIT_SELECTION")) {
        fprintf(stderr,"[opensmash] ready for character selection\n");
        while(atomic_load(&selected_fighter)<0)emscripten_futex_wait(&selected_fighter,-1,1000);
        fighter=atomic_load(&selected_fighter);
        /* The virtual disc reserves space for swapping costumes before launch.
         * Report their real lengths to Melee so its 24 MB heap never allocates
         * the reserved padding (especially in Classic and title demos). */
        unsigned fst=read32(s,0x80000038), count=read32(s,fst+8), changed=0;
        if(fst<0x80000000 || fst>=0x81800000 || count>10000)abort();
        unsigned strings=fst+count*12;
        for(unsigned i=1;i<count;i++) {
            unsigned entry=fst+i*12, type=read32(s,entry);
            if(type>>24)continue;
            char name[32]={0};unsigned address=strings+(type&0xffffff);
            for(unsigned j=0;j<31;j++){name[j]=moderngekko_mod_read(s,address+j,1);if(!name[j])break;}
            for(unsigned slot=0;slot<sizeof(costume_sizes)/sizeof(costume_sizes[0]);slot++)
                if(!strcmp(name,costume_names[slot]) && costume_sizes[slot]) {
                    moderngekko_mod_write(s,entry+8,costume_sizes[slot],4);changed++;break;
                }
        }
        fprintf(stderr,"[opensmash] actual costume lengths restored slots=%u\n",changed);
    }
#endif
    fprintf(stderr,"[opensmash] launch mode=%d stage=%d cpu=%d stocks=%d minutes=%d ports=%u,%u,%u,%u\n",
            launch_mode,arena,cpu_level,stocks,minutes,port_config[0],port_config[1],port_config[2],port_config[3]);
    if(launch_mode==4)original_pacing=1;
}
static void change_mode(CPUState* s) {
    unsigned next = s->gpr[3];
    if (requested && !routed && launch_mode!=4) {
        next=launch_mode==1?1:launch_mode==3?3:2;routed=1;
    }
    write8(s, 0x80479D31, next);
    write8(s, 0x80479D3C, 1);
    s->pc = s->lr;
}
static void vs_on_load(CPUState* s) {
    /* Original function clears the six per-player KO counts. */
    for (unsigned i = 0; i < 6; ++i) write8(s, 0x804D6730 + i, 0);
    if (!requested || prepared) { s->pc = s->lr; return; }
    unsigned preferences = read32(s, 0x804D3EE0);
    if (preferences < 0x80000000 || preferences >= 0x81800000) abort();
    /* gmMainLib_GetUnlockedCharactersBitmaskPtr (8015ED8C) returns base+1868.
     * The local roster includes Luigi/Marth even with a fresh virtual save.
     * Set all eleven unlock bits before CSS validates its player selections. */
    moderngekko_mod_write(s, preferences + 0x1868, 0x7FF, 2);
    moderngekko_mod_write(s, preferences + 0x186A, 0x7FF, 2);
    unsigned start = preferences + 0x590 + 8;
    moderngekko_mod_write(s, start + 0xE, arena, 2);
    write8(s, preferences + 0x1852, 1); /* stock rules */
    write8(s, preferences + 0x1854, stocks);
    write8(s, preferences + 0x1858, minutes);
    for (unsigned i = 0; i < 6; ++i) {
        unsigned player = start + 0x60 + i * 0x24;
        write8(s, player + 4, i);
        write8(s, player + 1, i < 4 ? ((port_config[i]>>8)&255) : 3);
        if (i < 4) {
            write8(s, player, port_config[i]&255);
            write8(s, player + 3, port_config[i]>>16);
            write8(s, player + 0xF, cpu_level);
        }
    }
    prepared = 1;
    fprintf(stderr, "[opensmash] launch fighter=%d opponent=%d stage=%d stocks=%d minutes=%d\n",
            fighter, opponent, arena, stocks, minutes);
    s->pc = s->lr;
}
static void menu_enter(CPUState* s) {
    if(launch_mode==1 && !destination_ready) {vs_on_load(s);write8(s,s->gpr[3],2);write8(s,s->gpr[3]+1,0);write8(s,s->gpr[3]+2,1);}
}
static void title_frame(CPUState* s) {(void)s;if(launch_mode==4)mark_ready();}
static void menu_frame(CPUState* s) {(void)s;if(launch_mode==1)mark_ready();}
static void classic_enter(CPUState* s) {
    if(launch_mode!=3)return;
    unsigned prefs=read32(s,0x804D3EE0);
    moderngekko_mod_write(s,prefs+0x1868,0x7FF,2);
    write8(s,prefs+0x51C,port_config[0]&255);write8(s,prefs+0x51D,stocks);
    write8(s,prefs+0x51E,port_config[0]>>16);write8(s,prefs+0x51F,(cpu_level-1)/2);
}
static void report_assert(CPUState* s) {
    char file[161] = {0}, message[241] = {0};
    for (unsigned i = 0; i + 1 < sizeof(file); ++i) {
        file[i] = (char)moderngekko_mod_read(s, s->gpr[3] + i, 1);
        if (!file[i]) break;
    }
    for (unsigned i = 0; i + 1 < sizeof(message); ++i) {
        message[i] = (char)moderngekko_mod_read(s, s->gpr[5] + i, 1);
        if (!message[i]) break;
    }
    unsigned sp = s->gpr[1];
    for (unsigned depth = 0; depth < 12 && sp >= 0x80000000 && sp < 0x81800000; ++depth) {
        fprintf(stderr, "[opensmash] stack %08x lr=%08x\n", sp, read32(s, sp + 4));
        unsigned next = read32(s, sp);
        if (next <= sp) break;
        sp = next;
    }
    fprintf(stderr, "[opensmash] guest assert %s:%u %s lr=%08x\n", file, s->gpr[4], message, s->lr);
}
static void css_frame(CPUState* s) {
    if(launch_mode==2 || launch_mode==3)mark_ready();
    if (prepared && !launched && css_frames++ == 0)
        fprintf(stderr, "[opensmash] character select ready\n");
    if (launch_mode==0 && prepared && !launched && css_frames >= 1)
        write8(s, 0x804D6CF6, 1); /* Let the original frame handler finish loading. */
}
static void stage_enter(CPUState* s) {
    if (launch_mode==0 && prepared && !launched) {
        fprintf(stderr, "[opensmash] stage select ready\n");
        write8(s, s->gpr[3] + 3, arena); /* SSSData.force_stage_id */
        launched = 1;
    }
}
static void combat_frame(CPUState* s) {
    (void)s;
    mark_ready();
#ifdef __EMSCRIPTEN__
    if (atomic_fetch_add(&combat_frames, 1) == 0)
        fprintf(stderr, "[opensmash] combat started\n");
#else
    static unsigned native_frames;
    if (native_frames++ == 0)
        fprintf(stderr, "[opensmash] combat started\n");
    if (native_frames == 180)
        fprintf(stderr, "[opensmash] native combat frame=180\n");
#endif
}
static const ModernGekkoModHook hooks[] = {
    RECOMP_HOOK(0x801A4510, scene_main),
    RECOMP_HOOK(0x801A1C18, title_frame),
    RECOMP_HOOK(0x8022DDA8, menu_enter),
    RECOMP_HOOK(0x8022DD38, menu_frame),
    RECOMP_HOOK(0x801B3DD8, classic_enter),
    RECOMP_HOOK(0x8016D800, combat_frame),
    RECOMP_HOOK(0x802669F4, css_frame),
    RECOMP_HOOK(0x8025A998, stage_enter),
    RECOMP_HOOK(0x80388220, report_assert),
    RECOMP_HOOK(0x80388278, report_assert),
};
static const ModernGekkoModPatch patches[] = {
    RECOMP_PATCH(0x801A42F8, change_mode),
    RECOMP_PATCH(0x801A55EC, vs_on_load),
};
static const ModernGekkoModDesc descriptor = {
    .abi_version = MODERNGEKKO_MOD_ABI_VERSION,
    .cpu_abi_version = MODERNGEKKO_CPU_ABI_VERSION,
    .cpu_state_size = sizeof(CPUState),
    .game_id = "GALE01",
    .id = "opensmash_launch",
    .version = "0.1.0",
    .display_name = "OpenSmash match launch (USA 1.02)",
    .patches = patches,
    .num_patches = 2,
    .hooks = hooks,
    .num_hooks = sizeof(hooks)/sizeof(hooks[0]),
    .on_load = on_load,
};
MODERNGEKKO_MOD_EXPORT const ModernGekkoModDesc* moderngekko_get_mod(void) {
    return &descriptor;
}
