package nl.kiteweer.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.DisplayMetrics;

import org.json.JSONObject;

/**
 * Tekent een compact windkompas voor het widget-overzicht: de 16 richtingen van de spot (groen =
 * beste, oranje = matig, rood-grijs = slecht/aflandig), een pijl uit de richting van het goede
 * moment (of vandaag), en de windsnelheid in knopen (`kn`) in het midden.
 */
final class KiteweerKompas {
    private KiteweerKompas() {}

    static Bitmap teken(Context context, JSONObject data, int maatDp) {
        JSONObject doel = KiteweerWidgetTekst.kompasDoel(data);
        if (doel == null) return null;

        boolean donker = KiteweerGrafiek.isDonker(context);
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        float s = Math.min(metrics.density, 3f);
        int px = Math.max(1, Math.round(maatDp * s));
        Bitmap bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);

        float cx = px / 2f;
        float cy = px / 2f;
        float rUit = px * 0.46f;
        float rIn = px * 0.30f;

        int[] standen = KiteweerWidgetTekst.sectorStanden(data.optJSONObject("spotWindrichting"));
        Paint boogPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        boogPaint.setStyle(Paint.Style.FILL);
        Paint randPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        randPaint.setStyle(Paint.Style.STROKE);
        randPaint.setStrokeWidth(Math.max(1f, 0.8f * s));
        randPaint.setColor(donker ? 0xFF1E2228 : 0xFFFFFFFF);

        RectF buiten = new RectF(cx - rUit, cy - rUit, cx + rUit, cy + rUit);
        RectF binnen = new RectF(cx - rIn, cy - rIn, cx + rIn, cy + rIn);
        for (int i = 0; i < 16; i++) {
            if (standen[i] == 1) boogPaint.setColor(donker ? 0xFF4CAF50 : 0xFF2ECC71);
            else if (standen[i] == 2) boogPaint.setColor(donker ? 0xFFFF9800 : 0xFFF5A623);
            else boogPaint.setColor(donker ? 0x55EF5350 : 0x44E74C3C);

            float startHoek = i * 22.5f - 11.25f - 90f;
            Path p = new Path();
            p.arcTo(buiten, startHoek, 22.5f, true);
            p.arcTo(binnen, startHoek + 22.5f, -22.5f, false);
            p.close();
            c.drawPath(p, boogPaint);
            c.drawPath(p, randPaint);
        }

        // Windpijl op de buitenring: wijst vanaf de windrichting naar het midden.
        float graden = (float) doel.optDouble("windrichtingGraden", 0);
        c.save();
        c.rotate(graden, cx, cy);
        Path pijl = new Path();
        pijl.moveTo(cx, cy - rIn + 1f * s);
        pijl.lineTo(cx - 4.2f * s, cy - rUit - 1.5f * s);
        pijl.lineTo(cx + 4.2f * s, cy - rUit - 1.5f * s);
        pijl.close();
        Paint pijlPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        pijlPaint.setColor(donker ? 0xFFFFFFFF : 0xFF1C1C1E);
        c.drawPath(pijl, pijlPaint);
        pijlPaint.setStyle(Paint.Style.STROKE);
        pijlPaint.setStrokeWidth(Math.max(1f, 0.9f * s));
        pijlPaint.setColor(donker ? 0xFF1E2228 : 0xFFFFFFFF);
        c.drawPath(pijl, pijlPaint);
        c.restore();

        // Knopen in het midden.
        int kn = (int) Math.round(doel.optDouble("windKnopen"));
        Paint knPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        knPaint.setColor(donker ? 0xFFF2F2F3 : 0xFF1C1C1E);
        knPaint.setTextAlign(Paint.Align.CENTER);
        knPaint.setTypeface(Typeface.DEFAULT_BOLD);
        knPaint.setTextSize(12.5f * s);
        c.drawText(String.valueOf(kn), cx, cy + 2.5f * s, knPaint);

        Paint eenheidPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        eenheidPaint.setColor(donker ? 0xFFB0B3B8 : 0xFF666666);
        eenheidPaint.setTextAlign(Paint.Align.CENTER);
        eenheidPaint.setTextSize(7.5f * s);
        c.drawText("kn", cx, cy + 10.5f * s, eenheidPaint);

        return bmp;
    }
}
