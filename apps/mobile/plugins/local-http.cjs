const {withAndroidManifest}=require('expo/config-plugins');
module.exports=(config)=>withAndroidManifest(config,(mod)=>{const api=process.env.EXPO_PUBLIC_API_URL??'http://10.0.2.2:4000/api';const app=mod.modResults.manifest.application?.[0];if(app)app.$['android:usesCleartextTraffic']=api.startsWith('http:')?'true':'false';return mod;});
