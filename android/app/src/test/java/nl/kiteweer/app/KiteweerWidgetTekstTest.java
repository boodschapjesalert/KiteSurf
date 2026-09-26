package nl.kiteweer.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class KiteweerWidgetTekstTest {

    private static JSONObject json(String tekst) throws Exception {
        return new JSONObject(tekst);
    }

    @Test
    public void scoreEnWind() throws Exception {
        assertEquals("7.5", KiteweerWidgetTekst.score(json("{\"score\":7.5}")));
        assertEquals("8", KiteweerWidgetTekst.score(json("{\"score\":8}")));
        assertEquals("–", KiteweerWidgetTekst.score(json("{\"score\":null}")));
        assertEquals("💨 18 kn ZW · vlagen 24 kn",
                KiteweerWidgetTekst.windTekst(json("{\"windKnopen\":18,\"windrichtingKompas\":\"ZW\",\"windvlaagKnopen\":24}")));
        assertEquals("", KiteweerWidgetTekst.windTekst(json("{\"windKnopen\":null}")));
    }

    @Test
    public void volgendeKans() throws Exception {
        assertEquals("Volgende kans: geen binnen je horizon", KiteweerWidgetTekst.kansTekst(json("{\"gevonden\":false}")));
        assertEquals("Volgende kans: Morgen 13:00–17:00 · 8/10", KiteweerWidgetTekst.kansTekst(
                json("{\"gevonden\":true,\"dagLabel\":\"Morgen\",\"vanaf\":\"13:00\",\"tot\":\"17:00\",\"score\":8}")));
    }

    @Test
    public void dagenUitNieuweBackend() throws Exception {
        JSONObject data = json("{\"dagen\":[{\"datum\":\"2026-09-26\"},{\"datum\":\"2026-09-27\"}],\"uren\":[]}");
        assertEquals(2, KiteweerWidgetTekst.dagen(data).length());
    }

    @Test
    public void dagenTerugvalOpOudeBackend() throws Exception {
        JSONObject data = json("{\"kleur\":\"groen\",\"score\":7,\"verdict\":\"Goed\",\"uren\":[{\"uur\":9,\"windKnopen\":18}]}");
        JSONArray dagen = KiteweerWidgetTekst.dagen(data);
        assertEquals(1, dagen.length());
        assertEquals("Vandaag", dagen.getJSONObject(0).getString("dagLabel"));
        assertEquals("groen", dagen.getJSONObject(0).getString("kleur"));
        assertEquals(1, dagen.getJSONObject(0).getJSONArray("uren").length());
        assertEquals(0, KiteweerWidgetTekst.dagen(json("{\"kleur\":\"rood\"}")).length());
    }

    @Test
    public void dagTeksten() throws Exception {
        JSONObject dag = json("{\"datum\":\"2026-09-27\",\"dagLabel\":\"Morgen\",\"datumKort\":\"zo 27 sep\",\"score\":7.5,"
                + "\"verdict\":\"Goede kite-conditie\",\"windKnopen\":18,\"windrichtingKompas\":\"ZW\",\"windvlaagKnopen\":24,"
                + "\"indicatief\":false,\"venster\":{\"vanaf\":\"13:00\",\"tot\":\"17:00\"}}");
        assertEquals("zo 7.5", KiteweerWidgetTekst.chipTekst(dag));
        assertEquals("zo 27 sep", KiteweerWidgetTekst.datumNaastLabel(dag));
        assertEquals("13:00–17:00", KiteweerWidgetTekst.vensterTekst(dag));
        assertEquals("Goede kite-conditie · 18 kn ZW · vlagen 24 kn", KiteweerWidgetTekst.dagDetail(dag));

        JSONObject verDag = json("{\"datum\":\"2026-10-01\",\"dagLabel\":\"do 1 okt\",\"datumKort\":\"do 1 okt\",\"score\":0,"
                + "\"verdict\":\"Niet geschikt om te kiten\",\"windKnopen\":null,\"indicatief\":true,\"venster\":null}");
        assertEquals("", KiteweerWidgetTekst.datumNaastLabel(verDag));
        assertEquals("", KiteweerWidgetTekst.vensterTekst(verDag));
        assertEquals("Niet geschikt om te kiten · indicatief", KiteweerWidgetTekst.dagDetail(verDag));
    }

    @Test
    public void weekdagEnUur() {
        assertEquals("za", KiteweerWidgetTekst.weekdag("2026-09-26"));
        assertNull(KiteweerWidgetTekst.weekdag("gisteren"));
        assertEquals(13, KiteweerWidgetTekst.uurVan("13:00"));
        assertEquals(-1, KiteweerWidgetTekst.uurVan(""));
    }

    @Test
    public void gezamenlijkeSchaal() throws Exception {
        JSONArray rustig = new JSONArray("[{\"uren\":[{\"windKnopen\":6,\"windvlaagKnopen\":9}]}]");
        assertEquals(15, KiteweerWidgetTekst.schaalMax(rustig));
        JSONArray stevig = new JSONArray("[{\"uren\":[{\"windKnopen\":12}]},{\"uren\":[{\"windKnopen\":22,\"windvlaagKnopen\":31}]}]");
        assertEquals(35, KiteweerWidgetTekst.schaalMax(stevig));
    }

    @Test
    public void paginas() throws Exception {
        long nu = 1_000_000_000L;
        assertEquals(2, KiteweerWidgetTekst.huidigePagina(2, nu - 60_000, nu, 4));
        assertEquals(0, KiteweerWidgetTekst.huidigePagina(2, nu - KiteweerWidgetTekst.PAGINA_GELDIG_MS - 1, nu, 4));
        assertEquals(0, KiteweerWidgetTekst.huidigePagina(5, nu, nu, 4));
        assertEquals(0, KiteweerWidgetTekst.huidigePagina(-1, nu, nu, 4));

        JSONArray dagen = new JSONArray("[{\"dagLabel\":\"Vandaag\"},{\"dagLabel\":\"Morgen\"}]");
        assertEquals("Overzicht · 1/3", KiteweerWidgetTekst.paginaLabel(dagen, 0));
        assertEquals("Morgen · 3/3", KiteweerWidgetTekst.paginaLabel(dagen, 2));
    }
}
