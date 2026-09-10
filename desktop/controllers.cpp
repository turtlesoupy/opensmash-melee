#include <SDL3/SDL.h>
#include <iostream>
#include <map>
#include <string>
int main(){
 if(!SDL_Init(SDL_INIT_GAMEPAD))return 1;
 int count=0;SDL_JoystickID* ids=SDL_GetGamepads(&count);std::map<std::string,int> sameNames;
 for(int i=0;i<count;i++){
  const char* value=SDL_GetJoystickNameForID(ids[i]);if(!value)continue;
  std::string name=value;if(name.find_first_of("\r\n")!=std::string::npos)continue;
  std::cout<<"SDL/"<<sameNames[name]++<<"/"<<name<<'\n';
 }
 SDL_free(ids);SDL_Quit();return 0;
}
