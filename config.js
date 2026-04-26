(function(global){
  const DEFAULTS = {
    // 這裡請在你部署新 Apps Script Web App 後，改成新的 /exec 網址
    API_URL: 'https://script.google.com/macros/s/AKfycby2fAM3Q5j9-4je9atMNzbdNIXn3-Y90nacN75jJgCyO7fSglgBR9iE-lOEacmh7dI_/exec',
    GOOGLE_CLIENT_ID: '1061451682971-664fkp8jnd3771srdrshujqalngnocla.apps.googleusercontent.com',
    CLOUDINARY_CLOUD_NAME: 'dkwzybiw9',
    CLOUDINARY_UPLOAD_PRESET: 'yuzu_unsigned2',
    CLOUDINARY_ROOT_FOLDER: 'employee-system',
    CLOUDINARY_CHUNK_SIZE_MB: 20,
    CLOUDINARY_SOFT_MAX_VIDEO_MB: 0,
    BUILD: '2026-04-24-reminder-center-clean-v2'
  };

  const params = new URLSearchParams(global.location.search || '');
  const queryApi = String(params.get('api') || '').trim();
  const storedApi = String(global.localStorage.getItem('EMPLOYEE_SYSTEM_API_BASE') || '').trim();
  const resolvedApi = queryApi || storedApi || DEFAULTS.API_URL;

  global.APP_CONFIG = Object.assign({}, DEFAULTS, { API_URL: resolvedApi });
  global.API_URL = resolvedApi;

  global.setEmployeeSystemApiUrl = function(url){
    const next = String(url || '').trim();
    if(next){
      global.localStorage.setItem('EMPLOYEE_SYSTEM_API_BASE', next);
    }else{
      global.localStorage.removeItem('EMPLOYEE_SYSTEM_API_BASE');
    }
    return next || DEFAULTS.API_URL;
  };

  global.resetEmployeeSystemApiUrl = function(){
    global.localStorage.removeItem('EMPLOYEE_SYSTEM_API_BASE');
    return DEFAULTS.API_URL;
  };
})(window);
