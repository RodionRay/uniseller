import Link from 'next/link';
import {AiAssistantWidget} from '@/components/product/ai-assistant-widget';
import {PRODUCT_NAME,PRODUCT_SITE,PRODUCT_SUMMARY,PRODUCT_TOPICS} from '@/lib/product-knowledge';

export const metadata={
  title:`${PRODUCT_NAME} — управление маркетплейсами`,
  description:PRODUCT_SUMMARY,
};

export default function SellingSitePage(){
  return (
    <div className="selling-site">
      <header className="selling-top">
        <Link href="/site" className="selling-brand">
          <span className="mark">u</span>
          uniseller<span className="brand-dot">.</span>
        </Link>
        <nav className="selling-nav">
          <a href="#capabilities">Возможности</a>
          <a href={PRODUCT_SITE} target="_blank" rel="noreferrer">uniseller.io</a>
          <Link href="/" className="selling-nav-cta">Кабинет</Link>
        </nav>
      </header>

      <main>
        <section className="selling-hero">
          <p className="eyebrow">WILDBERRIES · OZON · ЯНДЕКС МАРКЕТ</p>
          <h1>
            {PRODUCT_NAME}
            <em> для селлеров</em>
          </h1>
          <p className="selling-lead">
            Один контур для каталога, остатков, цен, заказов и аналитики. Спросите ассистента справа — он подскажет по продукту.
          </p>
          <div className="selling-cta-row">
            <a className="selling-btn primary" href={PRODUCT_SITE} target="_blank" rel="noreferrer">На сайт продукта</a>
            <a className="selling-btn ghost" href="#capabilities">Смотреть возможности</a>
          </div>
        </section>

        <section id="capabilities" className="selling-capabilities">
          <h2>Что закрывает Uniseller</h2>
          <p className="selling-section-lead">Коротко о сценариях, с которых обычно начинают селлеры.</p>
          <ul className="selling-topic-list">
            {PRODUCT_TOPICS.map((topic)=>(
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </section>

        <section className="selling-help">
          <h2>Нужна быстрая консультация?</h2>
          <p>AI-ассистент в правом углу отвечает по возможностям Uniseller, интеграциям и типичным задачам селлера — без ожидания менеджера.</p>
        </section>
      </main>

      <footer className="selling-footer">
        <span>{PRODUCT_NAME}</span>
        <Link href="/">Рабочее пространство</Link>
      </footer>

      <AiAssistantWidget surface="site"/>
    </div>
  );
}
