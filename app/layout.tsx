import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const sans=localFont({src:'../public/fonts/SourceSans3.ttf',variable:'--font-sans',display:'swap'});
const display=localFont({src:'../public/fonts/Fraunces.ttf',variable:'--font-display',display:'swap'});
export const metadata:Metadata={title:'Ludex · your life in stories',description:'A cinematic journal for your films, shows and games. Collect what stays with you.',icons:{icon:'/icon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className={`${sans.variable} ${display.variable}`}><body>{children}</body></html>}
