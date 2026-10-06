import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './premiere.css';
const sora=localFont({src:'../public/fonts/Sora.woff2',variable:'--font-sora',weight:'100 800',display:'swap'});
export const metadata:Metadata={title:'Ludex · your life in stories',description:'A cinematic journal for your films, shows and games. Collect what stays with you.',icons:{icon:'/icon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className={sora.variable}><body>{children}</body></html>}
