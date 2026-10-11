import { Text, View, StyleProp, ViewStyle } from 'react-native';
import { colors, font } from '../theme';

/**
 * Renders numerals in fixed-width cells so a ticking timer / distance never jitters sideways
 * (the display font has proportional digits).
 *
 * Each glyph is drawn in a wide, absolutely positioned Text centred on its cell. That way a glyph
 * that is slightly wider than the cell can never be truncated with "…" the way a Text sized to the
 * cell would be, and `ellipsizeMode="clip"` guarantees no ellipsis even in edge cases.
 */
export function Digits({
  value,
  size,
  color = colors.text,
  weight = font.d800,
  style,
}: {
  value: string;
  size: number;
  color?: string;
  weight?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const digitW = size * 0.5;
  const punctW = size * 0.24;
  const lineH = size * 1.02;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-start' }, style]}>
      {value.split('').map((ch, i) => {
        const cell = ch >= '0' && ch <= '9' ? digitW : punctW;
        const wide = size * 2; // room for any glyph
        return (
          <View key={i} style={{ width: cell, height: lineH }}>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              ellipsizeMode="clip"
              style={{
                position: 'absolute',
                top: 0,
                left: (cell - wide) / 2,
                width: wide,
                textAlign: 'center',
                fontFamily: weight,
                fontSize: size,
                lineHeight: lineH,
                color,
                includeFontPadding: false,
              }}
            >
              {ch}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Width of a numeral string in em, matching the cell widths used by <Digits>. */
export const emWidth = (value: string) =>
  value.split('').reduce((a, ch) => a + (ch >= '0' && ch <= '9' ? 0.5 : 0.24), 0);

/**
 * Picks one font size so several numbers fit side by side in `avail` px, leaving `padPerCol` of
 * breathing room per column. Columns should use `flex = emWidth(value) + 1` so wider numbers get wider columns.
 */
export const fitSize = (values: string[], avail: number, maxSize: number, padPerCol = 20) => {
  const em = values.reduce((a, v) => a + emWidth(v), 0);
  return Math.max(24, Math.min(maxSize, Math.floor((avail - padPerCol * values.length) / Math.max(em, 1))));
};
