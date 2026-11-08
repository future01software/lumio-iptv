/* eslint-env node */
// Podfile fixes for building with Xcode 27, re-applied on every `expo prebuild`
// (the generated ios/ folder is not committed):
// - Xcode 27 rejects pod deployment targets below iOS 15; raise old pods to the app's target.
// - fmt's consteval format strings fail to compile with newer clang.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const MARKER = "# lumio-ios-pod-fixes";

const SNIPPET = `
    ${MARKER}
    fmt_base_path = File.join(__dir__, 'Pods/fmt/include/fmt/base.h')
    if File.exist?(fmt_base_path)
      content = File.read(fmt_base_path)
      if content.include?('#  define FMT_CONSTEVAL consteval')
        File.chmod(0644, fmt_base_path)
        File.write(fmt_base_path, content.gsub('#  define FMT_CONSTEVAL consteval', '#  define FMT_CONSTEVAL // patched for newer clang'))
        File.chmod(0444, fmt_base_path)
      end
    end
    app_deployment_target = podfile_properties['ios.deploymentTarget'] || '15.1'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        pod_target = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if pod_target.nil? || Gem::Version.new(pod_target) < Gem::Version.new(app_deployment_target)
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = app_deployment_target
        end
      end
    end
`;

module.exports = function withIosPodFixes(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let src = fs.readFileSync(podfile, "utf8");
      if (!src.includes(MARKER)) {
        // Insert right after the react_native_post_install(...) call.
        src = src.replace(/(react_native_post_install\([\s\S]*?\n\s*\)\n)/, `$1${SNIPPET}`);
        fs.writeFileSync(podfile, src);
      }
      return cfg;
    },
  ]);
};
