import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit

// Mirrors the upstream template's SceneDelegate (react-native-community/template#246),
// adapted to the RN 0.85 factory API, which has no `connectionOptions:` start overload.
// No RCTLinkingManager scene hooks: the app has no deep links and 0.85 lacks those APIs.
class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    dependencyProvider = RCTAppDependencyProvider()
    // The factory holds its delegate weakly; the scene retains this SceneDelegate.
    let factory = RCTReactNativeFactory(delegate: self)
    reactNativeFactory = factory
    window = UIWindow(windowScene: windowScene)

    factory.startReactNative(withModuleName: "BmoniEmbeddedExample", in: window)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
