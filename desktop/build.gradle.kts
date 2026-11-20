import org.jetbrains.compose.desktop.application.dsl.TargetFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("multiplatform") version "2.0.21"
    id("org.jetbrains.compose") version "1.7.3"
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    id("com.android.application") version "8.7.3"
}

group = "com.isecure"
version = "0.1.0"

kotlin {
    androidTarget {
        compilations.all {
            compileTaskProvider.configure {
                compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
            }
        }
    }
    jvm("desktop") {
        compilations.all {
            compileTaskProvider.configure {
                compilerOptions { jvmTarget.set(JvmTarget.JVM_21) }
            }
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.ui)
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.6.1")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
        }
        // src/jvmMain holds code shared by the two JVM-family targets
        // (crypto + file stores). The default hierarchy template does not
        // wire a jvmMain group in this AGP combination, so both targets
        // include the directory directly.
        val androidMain by getting
        val desktopMain by getting
        androidMain.kotlin.srcDir("src/jvmMain/kotlin")
        desktopMain.kotlin.srcDir("src/jvmMain/kotlin")
        androidMain.dependencies {
            implementation("androidx.activity:activity-compose:1.9.3")
            // Google Identity Authorization API (Drive sign-in port) and
            // BiometricPrompt (fingerprint unlock port) — the same
            // libraries the Capacitor plugins used.
            implementation("com.google.android.gms:play-services-auth:21.3.0")
            implementation("androidx.biometric:biometric:1.1.0")
        }
        desktopMain.dependencies {
            implementation(compose.desktop.currentOs)
        }
    }
}

// Release signing is injected by CI (kmp-release.yml) through the
// environment, exactly like the Capacitor workflow: the decrypted
// keystore path + the three signing secrets. Without them (local dev),
// the release build stays unsigned and only assembleDebug is used.
val kmpKeystoreFile = System.getenv("ISECURE_KEYSTORE_FILE")

android {
    namespace = "com.isecure.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.isecure.app"
        minSdk = 23
        targetSdk = 35
        // Version metadata tracks the shipped edition (AUD-021): the
        // Kotlin edition is the same app identity and must never carry
        // a versionCode the shipped build has already passed. Kept in
        // lockstep with the Capacitor build at 2.0.3 / 10; a future
        // Kotlin release bumps both fields past the shipped values.
        versionCode = 10
        versionName = "2.0.3"
    }
    if (kmpKeystoreFile != null) {
        signingConfigs {
            create("release") {
                storeFile = file(kmpKeystoreFile)
                storePassword = System.getenv("ISECURE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ISECURE_KEY_ALIAS")
                keyPassword = System.getenv("ISECURE_KEY_PASSWORD")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (kmpKeystoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

compose.desktop {
    application {
        mainClass = "com.isecure.desktop.MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Deb, TargetFormat.Msi, TargetFormat.Exe)
            packageName = "iSecure"
            packageVersion = "1.0.0"
            description = "iSecure — zero-knowledge password manager (desktop)"
            vendor = "Farzad Sholeh"
        }
    }
}
