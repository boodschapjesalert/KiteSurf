package nl.kiteweer.app;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** HTTP naar de Apps Script-backend. Los van Android-klassen, zodat het op de JVM te testen is. */
final class KiteweerHttp {
    private KiteweerHttp() {}

    /**
     * POST naar de Apps Script /exec-URL. Die antwoordt met een 302 naar
     * script.googleusercontent.com, waar het antwoord met een GET opgehaald moet worden — dat
     * doen we zelf i.p.v. te vertrouwen op het redirect-gedrag van HttpURLConnection.
     */
    static JSONObject postJson(String url, JSONObject body) throws IOException, JSONException {
        HttpURLConnection verbinding = (HttpURLConnection) new URL(url).openConnection();
        try {
            verbinding.setInstanceFollowRedirects(false);
            verbinding.setConnectTimeout(30000);
            verbinding.setReadTimeout(120000);
            verbinding.setRequestMethod("POST");
            verbinding.setDoOutput(true);
            verbinding.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            verbinding.setFixedLengthStreamingMode(data.length);
            try (OutputStream uit = verbinding.getOutputStream()) {
                uit.write(data);
            }
            int code = verbinding.getResponseCode();
            if (code >= 300 && code < 400) {
                String locatie = verbinding.getHeaderField("Location");
                if (locatie == null) throw new IOException("Redirect zonder Location");
                return getJson(new URL(new URL(url), locatie).toString(), 5);
            }
            return leesJsonAntwoord(verbinding, code);
        } finally {
            verbinding.disconnect();
        }
    }

    private static JSONObject getJson(String url, int resterendeRedirects) throws IOException, JSONException {
        HttpURLConnection verbinding = (HttpURLConnection) new URL(url).openConnection();
        try {
            verbinding.setInstanceFollowRedirects(false);
            verbinding.setConnectTimeout(30000);
            verbinding.setReadTimeout(120000);
            int code = verbinding.getResponseCode();
            if (code >= 300 && code < 400 && resterendeRedirects > 0) {
                String locatie = verbinding.getHeaderField("Location");
                if (locatie == null) throw new IOException("Redirect zonder Location");
                return getJson(new URL(new URL(url), locatie).toString(), resterendeRedirects - 1);
            }
            return leesJsonAntwoord(verbinding, code);
        } finally {
            verbinding.disconnect();
        }
    }

    private static JSONObject leesJsonAntwoord(HttpURLConnection verbinding, int code) throws IOException, JSONException {
        if (code != 200) throw new IOException("HTTP " + code);
        try (InputStream in = verbinding.getInputStream()) {
            return new JSONObject(leesAlles(in));
        }
    }


    static String leesAlles(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] blok = new byte[8192];
        int gelezen;
        while ((gelezen = in.read(blok)) != -1) buffer.write(blok, 0, gelezen);
        return buffer.toString("UTF-8");
    }
}
