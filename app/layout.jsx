import './globals.css';

export const metadata = {
  title: '就活ポータル',
  description: '就活の企業・締切・ES一元管理',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
