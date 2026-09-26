package nl.kiteweer.app;

import android.Manifest;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/**
 * Brug tussen de web-kant (src/app/app.js) en de Android-kant: na het laden/opslaan van het
 * profiel de widget verversen, de achtergrondtaken bijwerken en zo nodig om toestemming voor
 * meldingen vragen (Android 13+).
 */
@CapacitorPlugin(
        name = "KiteweerNative",
        permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "meldingen") }
)
public class KiteweerNativePlugin extends Plugin {

    @PluginMethod
    public void profielGewijzigd(PluginCall call) {
        Context context = getContext();
        KiteweerAchtergrond.planPeriodiek(context);
        KiteweerAchtergrond.verversNu(context);
        if (Build.VERSION.SDK_INT >= 33 && meldingenAan(context) && getPermissionState("meldingen") != PermissionState.GRANTED) {
            requestPermissionForAlias("meldingen", call, "naMeldingToestemming");
            return;
        }
        call.resolve();
    }

    @PermissionCallback
    private void naMeldingToestemming(PluginCall call) {
        call.resolve();
    }

    private static boolean meldingenAan(Context context) {
        String tekst = context.getSharedPreferences(KiteweerAchtergrond.PREFS_CAPACITOR, Context.MODE_PRIVATE)
                .getString(KiteweerAchtergrond.SLEUTEL_PROFIEL, null);
        if (tekst == null) return false;
        try {
            JSONObject meldingen = new JSONObject(tekst).optJSONObject("meldingen");
            return meldingen != null && (meldingen.optBoolean("dagelijkseSamenvatting") || meldingen.optBoolean("directeAlert"));
        } catch (Exception e) {
            return false;
        }
    }
}
