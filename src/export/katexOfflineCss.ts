import katexCss from 'virtual:colwrite-katex-css';
import amsRegular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline';
import caligraphicBold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline';
import caligraphicRegular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline';
import frakturBold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline';
import frakturRegular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline';
import mainBold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?inline';
import mainBoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline';
import mainItalic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?inline';
import mainRegular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?inline';
import mathBoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline';
import mathItalic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?inline';
import sansSerifBold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline';
import sansSerifItalic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline';
import sansSerifRegular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline';
import scriptRegular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?inline';
import size1Regular from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline';
import size2Regular from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline';
import size3Regular from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline';
import size4Regular from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline';
import typewriterRegular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline';

const fontData: Record<string, string> = {
  'KaTeX_AMS-Regular': amsRegular,
  'KaTeX_Caligraphic-Bold': caligraphicBold,
  'KaTeX_Caligraphic-Regular': caligraphicRegular,
  'KaTeX_Fraktur-Bold': frakturBold,
  'KaTeX_Fraktur-Regular': frakturRegular,
  'KaTeX_Main-Bold': mainBold,
  'KaTeX_Main-BoldItalic': mainBoldItalic,
  'KaTeX_Main-Italic': mainItalic,
  'KaTeX_Main-Regular': mainRegular,
  'KaTeX_Math-BoldItalic': mathBoldItalic,
  'KaTeX_Math-Italic': mathItalic,
  'KaTeX_SansSerif-Bold': sansSerifBold,
  'KaTeX_SansSerif-Italic': sansSerifItalic,
  'KaTeX_SansSerif-Regular': sansSerifRegular,
  'KaTeX_Script-Regular': scriptRegular,
  'KaTeX_Size1-Regular': size1Regular,
  'KaTeX_Size2-Regular': size2Regular,
  'KaTeX_Size3-Regular': size3Regular,
  'KaTeX_Size4-Regular': size4Regular,
  'KaTeX_Typewriter-Regular': typewriterRegular,
};

const sourceRule =
  /src:url\(fonts\/(KaTeX_[A-Za-z0-9-]+)\.woff2\) format\("woff2"\),url\(fonts\/\1\.woff\) format\("woff"\),url\(fonts\/\1\.ttf\) format\("truetype"\)/g;

function embedKatexFonts(): string {
  const embedded = new Set<string>();
  const css = katexCss.replace(sourceRule, (_source, fontName: string) => {
    const data = fontData[fontName];
    if (!data) throw new Error(`Missing embedded KaTeX font: ${fontName}`);
    embedded.add(fontName);
    return `src:url("${data}") format("woff2")`;
  });

  if (embedded.size !== Object.keys(fontData).length || css.includes('url(fonts/KaTeX_')) {
    throw new Error(
      'KaTeX CSS and the embedded export font manifest are out of sync '
      + `(embedded ${embedded.size}/${Object.keys(fontData).length}, `
      + `relative URLs ${css.includes('url(fonts/KaTeX_')}, `
      + `first source ${css.match(/src:[^}]*/)?.[0]?.slice(0, 160) ?? 'none'})`,
    );
  }
  return css;
}

/** KaTeX styles with every font replaced by an artifact-local data URL. */
export const katexOfflineCss = embedKatexFonts();
