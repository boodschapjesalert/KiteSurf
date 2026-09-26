package nl.kiteweer.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigen plugin (widget/meldingen), vóór super.onCreate registreren.
        registerPlugin(KiteweerNativePlugin.class);
        super.onCreate(savedInstanceState);
        KiteweerMeldingen.maakKanalen(this);
        KiteweerAchtergrond.planPeriodiek(this);
    }
}
